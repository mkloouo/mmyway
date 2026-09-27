import { eq } from 'drizzle-orm';
import { inboxItems } from '../db/schema';
import type { Draft } from './draft';
import type { OutboxDb } from '../sync/outbox';

const NOT_EDITABLE = new Set(['confirmed', 'synced']);

export async function updateDraft(db: OutboxDb, inboxItemId: string, patch: Partial<Draft>): Promise<void> {
  const rows = await db.select().from(inboxItems).where(eq(inboxItems.id, inboxItemId));
  const item = rows[0];
  if (!item) throw new Error(`inbox item ${inboxItemId} not found`);
  if (NOT_EDITABLE.has(item.state)) throw new Error(`cannot update inbox item ${inboxItemId}: already ${item.state}`);

  const draft: Draft = JSON.parse(item.draftJson);
  const merged: Draft = { ...draft, ...patch };
  await db.update(inboxItems)
    .set({ draftJson: JSON.stringify(merged), updatedAt: new Date().toISOString() })
    .where(eq(inboxItems.id, inboxItemId));
}
