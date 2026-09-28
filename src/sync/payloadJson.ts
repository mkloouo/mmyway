// outbox_operations.payload_json can sit in the queue across an app update, so — like draft_json
// (src/inbox/draftJson.ts) — it is written with a version and validated when read back. A payload
// that doesn't match fails its operation with a readable message instead of sending garbage.
import { z } from 'zod';
import type { OutboxKind } from './outbox';

export const PAYLOAD_VERSION = 1;

const version = z.literal(PAYLOAD_VERSION).optional();
const changes = z.record(z.string(), z.unknown());

const SCHEMAS = {
  create_transaction: z.looseObject({ v: version, clientId: z.string(), splits: z.array(z.looseObject({})) }),
  update_transaction: z.looseObject({ v: version, groupId: z.string(), transactionJournalId: z.string(), expectedUpdatedAt: z.string(), changes }),
  recurring_review: z.looseObject({ v: version, groupId: z.string(), transactionJournalId: z.string(), expectedUpdatedAt: z.string().optional(), changes }),
  delete_transaction: z.looseObject({ v: version, groupId: z.string(), expectedUpdatedAt: z.string().optional() }),
  attach_receipt: z.looseObject({ v: version, transactionJournalId: z.string(), receiptImagePath: z.string(), attachmentId: z.string().optional() }),
  update_account: z.looseObject({
    v: version, accountId: z.string(), setEnvelopeMarker: z.boolean().optional(), active: z.boolean().optional(),
    order: z.number().optional(), edit: changes.optional(),
  }),
} satisfies Record<OutboxKind, z.ZodType>;

export function readPayload<T = Record<string, unknown>>(kind: OutboxKind, json: string): T {
  const result = SCHEMAS[kind].safeParse(JSON.parse(json));
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`unreadable ${kind} payload (${issue ? `${issue.path.join('.') || '(root)'}: ${issue.message}` : result.error.message})`);
  }
  const { v: _v, ...payload } = result.data as Record<string, unknown>;
  return payload as T;
}

export function writePayload(payload: object): string {
  return JSON.stringify({ ...payload, v: PAYLOAD_VERSION });
}
