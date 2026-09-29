// outbox_operations.payload_json can sit in the queue across an app update, so — like draft_json
// (src/inbox/draftJson.ts) — it is written with a version and validated when read back. A payload
// that doesn't match fails its operation with a readable message instead of sending garbage.
import { z } from 'zod';
import type { OutboxKind } from './outbox';

export const PAYLOAD_VERSION = 1;

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
  update_account: z.looseObject({
    v: version,
    accountId: z.string(),
    setEnvelopeMarker: z.boolean().optional(),
    active: z.boolean().optional(),
    order: z.number().optional(),
    edit: changes.optional(),
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

const GROUP_KINDS: readonly OutboxKind[] = [
  'update_transaction',
  'recurring_review',
  'delete_transaction',
];

/**
 * The transaction group a queued edit, review or delete points at; null for any other kind and for
 * an unreadable payload. For lists and screens that must never throw while rendering.
 */
export function payloadGroupId(kind: OutboxKind, json: string): string | null {
  if (!GROUP_KINDS.includes(kind)) return null;
  try {
    return readPayload<{ groupId: string }>(kind, json).groupId;
  } catch {
    return null;
  }
}

export function writePayload(payload: object): string {
  return JSON.stringify({ ...payload, v: PAYLOAD_VERSION });
}
