// outbox_operations.payload_json can sit in the queue across an app update, so — like draft_json
// (src/inbox/draftJson.ts) — it is written with a version and validated when read back. A payload
// that doesn't match fails its operation with a readable message instead of sending garbage.
import { z } from 'zod';
import { logLine } from '../utils/log';
import type { OutboxKind } from './outbox';

const PAYLOAD_VERSION = 1;

const version = z.literal(PAYLOAD_VERSION).optional();
const changes = z.record(z.string(), z.unknown());

const SCHEMAS = {
  create_transaction: z.looseObject({
    v: version,
    clientId: z.string(),
    splits: z.array(z.looseObject({})),
  }),
  update_transaction: z.looseObject({
    v: version,
    groupId: z.string(),
    transactionJournalId: z.string(),
    expectedUpdatedAt: z.string(),
    changes,
    splits: z.array(z.looseObject({})).optional(),
    groupTitle: z.string().optional(),
    removedJournalIds: z.array(z.string()).optional(),
    applied: z.boolean().optional(),
  }),
  recurring_review: z.looseObject({
    v: version,
    groupId: z.string(),
    transactionJournalId: z.string(),
    expectedUpdatedAt: z.string().optional(),
    changes,
  }),
  delete_transaction: z.looseObject({
    v: version,
    groupId: z.string(),
    expectedUpdatedAt: z.string().optional(),
  }),
  attach_receipt: z.looseObject({
    v: version,
    transactionJournalId: z.string(),
    receiptImagePath: z.string(),
    attachmentId: z.string().optional(),
  }),
  delete_attachment: z.looseObject({
    v: version,
    attachmentId: z.string(),
    transactionJournalId: z.string(),
  }),
  update_account: z.looseObject({
    v: version,
    accountId: z.string(),
    setEnvelopeMarker: z.boolean().optional(),
    active: z.boolean().optional(),
    order: z.number().optional(),
    edit: changes.optional(),
  }),
  reorder_accounts: z.looseObject({
    v: version,
    orderedIds: z.array(z.string()),
  }),
  save_planned: z.looseObject({
    v: version,
    key: z.string(),
    fields: z.looseObject({
      name: z.string(),
      type: z.enum(['withdrawal', 'deposit', 'transfer']),
      amount: z.string(),
      currencyCode: z.string(),
      date: z.string(),
      repeats: z.boolean(),
      frequency: z.string(),
      every: z.number(),
      tags: z.array(z.string()),
    }),
    before: z.looseObject({}).nullable(),
    billId: z.string().nullish(),
    ruleId: z.string().nullish(),
    recurrenceId: z.string().nullish(),
    recurrenceReplaced: z.boolean().optional(),
    replacedRecurrenceIds: z.array(z.string()).optional(),
  }),
  delete_planned: z.looseObject({
    v: version,
    key: z.string(),
    name: z.string(),
    billId: z.string().nullish(),
    ruleId: z.string().nullish(),
    recurrenceId: z.string().nullish(),
  }),
} satisfies Record<OutboxKind, z.ZodType>;

export function readPayload<T = Record<string, unknown>>(kind: OutboxKind, json: string): T {
  const result = SCHEMAS[kind].safeParse(JSON.parse(json));
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(
      `unreadable ${kind} payload (${issue ? `${issue.path.join('.') || '(root)'}: ${issue.message}` : result.error.message})`,
    );
  }
  const { v: _v, ...payload } = result.data as Record<string, unknown>;
  return payload as T;
}

const GROUP_KINDS: readonly string[] = [
  'update_transaction',
  'recurring_review',
  'delete_transaction',
];

const warned = new Set<string>();

/**
 * readPayload for lists, overlays and screens that must never throw while rendering: null for a
 * payload that can't be read (not JSON, not the shape its kind needs) or a kind this build doesn't
 * know. Such an operation fails on its own when it is replayed; the screens just skip it. Logged
 * once per payload, without its values — these run on every render.
 */
export function tryReadPayload<T = Record<string, unknown>>(kind: string, json: string): T | null {
  try {
    if (!Object.hasOwn(SCHEMAS, kind)) throw new Error(`unknown outbox operation kind: ${kind}`);
    return readPayload<T>(kind as OutboxKind, json);
  } catch (err) {
    const message =
      err instanceof Error && /^(unreadable|unknown) /.test(err.message)
        ? err.message
        : `unreadable ${kind} payload (not valid JSON)`;
    const key = `${kind}:${json}`;
    if (!warned.has(key)) {
      if (warned.size >= 200) warned.clear();
      warned.add(key);
      logLine('warn', message);
    }
    return null;
  }
}

/**
 * The transaction group a queued edit, review or delete points at; null for any other kind and for
 * an unreadable payload.
 */
export function payloadGroupId(kind: string, json: string): string | null {
  if (!GROUP_KINDS.includes(kind)) return null;
  return tryReadPayload<{ groupId: string }>(kind, json)?.groupId ?? null;
}

export function writePayload(payload: object): string {
  return JSON.stringify({ ...payload, v: PAYLOAD_VERSION });
}
