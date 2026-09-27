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
  // Payee text: the merchant for a withdrawal, the payer for a deposit. Ignored for a transfer,
  // which has no payee (defect (1)).
  merchantRawInput?: string;
  // The screen's "new payee" checkbox (brief §3.4: new payee stays explicit) — when set, skips
  // alias matching entirely rather than relying on "no alias found" to imply newness.
  forceNewPayee?: boolean;
  sourceId?: string; // asset account id: source for withdrawal/transfer
  sourceName?: string;
  destinationId?: string; // asset account id: destination for deposit/transfer
  destinationName?: string;
  categoryName?: string;
  budgetId?: string;
  notes?: string;
  foreignAmount?: string;
  foreignCurrencyCode?: string;
  sharedWith?: string;
}

export async function createManualEntry(db: OutboxDb, input: ManualEntryInput): Promise<{ inboxItemId: string; draft: Draft; isNewPayee: boolean }> {
  const shared = {
    amount: input.amount,
    currencyCode: input.currencyCode,
    date: input.date,
    description: input.description,
    categoryName: input.categoryName,
    budgetId: input.budgetId,
    notes: input.notes,
    foreignAmount: input.foreignAmount,
    foreignCurrencyCode: input.foreignCurrencyCode,
    sharedWith: input.sharedWith,
  };

  let draft: Draft;
  let isNewPayee: boolean;

  if (input.type === 'withdrawal') {
    isNewPayee = input.forceNewPayee ?? true;
    let destinationId: string | undefined;
    let destinationName = input.merchantRawInput;
    if (!input.forceNewPayee) {
      const aliasMatch = await matchAlias(db, 'payee', input.merchantRawInput ?? '');
      isNewPayee = !aliasMatch.matched;
      if (aliasMatch.matched) {
        destinationId = aliasMatch.alias.targetId ?? undefined;
        destinationName = aliasMatch.alias.targetName;
      }
    }
    draft = {
      ...shared, type: 'withdrawal', isNewPayee,
      sourceId: input.sourceId, sourceName: input.sourceName,
      destinationId, destinationName,
    };
  } else if (input.type === 'deposit') {
    isNewPayee = input.forceNewPayee ?? true;
    let sourceId: string | undefined;
    let sourceName = input.merchantRawInput;
    if (!input.forceNewPayee) {
      const aliasMatch = await matchAlias(db, 'payee', input.merchantRawInput ?? '');
      isNewPayee = !aliasMatch.matched;
      if (aliasMatch.matched) {
        sourceId = aliasMatch.alias.targetId ?? undefined;
        sourceName = aliasMatch.alias.targetName;
      }
    }
    draft = {
      ...shared, type: 'deposit', isNewPayee,
      sourceId, sourceName,
      destinationId: input.destinationId, destinationName: input.destinationName,
    };
  } else {
    // transfer: both ends are known asset accounts, no payee alias lookup at all (defect (1)).
    isNewPayee = false;
    draft = {
      ...shared, type: 'transfer', isNewPayee,
      sourceId: input.sourceId, sourceName: input.sourceName,
      destinationId: input.destinationId, destinationName: input.destinationName,
    };
  }

  const id = generateId();
  const now = new Date().toISOString();
  await db.insert(inboxItems).values({
    id, kind: 'manual_entry', state: 'captured', draftJson: JSON.stringify(draft),
    createdAt: now, updatedAt: now,
  });

  return { inboxItemId: id, draft, isNewPayee };
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
