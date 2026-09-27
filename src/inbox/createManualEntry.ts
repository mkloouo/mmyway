import { eq } from 'drizzle-orm';
import { inboxItems } from '../db/schema';
import { matchAlias } from '../lookup/aliases';
import { transition } from './state';
import { draftToTransactionPayload, type Draft } from './draft';
import { enqueueOperation } from '../sync/outbox';
import type { OutboxDb } from '../sync/outbox';
import { generateId } from '../utils/id';

export interface ManualEntryInput {
  type: Draft['type'];
  amount: string;
  currencyCode: string;
  date: string;
  description: string;
  merchantRawInput: string; // payee for withdrawal, source for deposit
  sourceId?: string; // asset account the money moves from/to
}

export async function createManualEntry(db: OutboxDb, input: ManualEntryInput): Promise<{ inboxItemId: string; draft: Draft; isNewPayee: boolean }> {
  const aliasMatch = await matchAlias(db, 'payee', input.merchantRawInput);
  const draft: Draft = {
    type: input.type,
    amount: input.amount,
    currencyCode: input.currencyCode,
    date: input.date,
    description: input.description,
    sourceId: input.sourceId,
    destinationId: aliasMatch.matched ? aliasMatch.alias.targetId ?? undefined : undefined,
    destinationName: aliasMatch.matched ? aliasMatch.alias.targetName : input.merchantRawInput,
    isNewPayee: !aliasMatch.matched,
    categoryName: undefined, // filled in by the draft screen from suggest/, not here
  };

  const id = generateId();
  const now = new Date().toISOString();
  await db.insert(inboxItems).values({
    id, kind: 'manual_entry', state: 'captured', draftJson: JSON.stringify(draft),
    createdAt: now, updatedAt: now,
  });

  return { inboxItemId: id, draft, isNewPayee: !aliasMatch.matched };
}

export async function confirmInboxItem(db: OutboxDb, inboxItemId: string): Promise<void> {
  const rows = await db.select().from(inboxItems).where(eq(inboxItems.id, inboxItemId));
  const item = rows[0];
  if (!item) throw new Error(`inbox item ${inboxItemId} not found`);

  const nextState = transition(item.state as any, 'confirm');
  const draft: Draft = JSON.parse(item.draftJson);

  await db.update(inboxItems).set({ state: nextState, updatedAt: new Date().toISOString() }).where(eq(inboxItems.id, inboxItemId));
  await enqueueOperation(db, {
    id: generateId(),
    inboxItemId,
    kind: 'create_transaction',
    payload: draftToTransactionPayload(inboxItemId, draft),
  });
}
