import { eq } from 'drizzle-orm';
import type { AccountRead } from '../api/ff3/types';
import { ff3AccountBody } from '../accounts/accountEdit';
import { setEnvelopeMarker } from '../accounts/envelopeMarker';
import { outboxOperations } from '../db/schema';
import type {
  OutboxRow,
  ReorderAccountsPayload,
  ReplayContext,
  ReplayOutcome,
  UpdateAccountPayload,
} from './outboxTypes';

export async function replayUpdateAccount(
  ctx: ReplayContext,
  p: UpdateAccountPayload,
  row: OutboxRow,
): Promise<ReplayOutcome> {
  const { db, client } = ctx;
  const body: Record<string, unknown> = p.edit ? ff3AccountBody(p.edit) : {};
  if (p.setEnvelopeMarker !== undefined) {
    const current = await client.request<{ data: AccountRead }>(`/v1/accounts/${p.accountId}`);
    const currentNotes = (current.data.attributes as { notes?: string | null }).notes ?? null;
    body.notes = setEnvelopeMarker(currentNotes, p.setEnvelopeMarker);
  }
  if (p.active !== undefined) body.active = p.active;
  if (p.order !== undefined) body.order = p.order;
  await client.request(`/v1/accounts/${p.accountId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  await db.delete(outboxOperations).where(eq(outboxOperations.id, row.id));
  return 'done';
}

export async function replayReorderAccounts(
  ctx: ReplayContext,
  p: ReorderAccountsPayload,
  row: OutboxRow,
): Promise<ReplayOutcome> {
  const { db, client } = ctx;
  for (const [index, accountId] of p.orderedIds.entries()) {
    await client.request(`/v1/accounts/${accountId}`, {
      method: 'PUT',
      body: JSON.stringify({ order: index + 1 }),
    });
  }
  await db.delete(outboxOperations).where(eq(outboxOperations.id, row.id));
  return 'done';
}
