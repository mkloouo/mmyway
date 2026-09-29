import { and, eq, inArray } from 'drizzle-orm';
import { inboxItems, outboxOperations } from '../db/schema';
import { resolvePayeeAlias } from '../lookup/aliases';
import { transition, type InboxState } from './state';
import { draftToTransactionPayload, type Draft } from './draft';
import { enqueueOperationSync } from '../sync/outbox';
import { requestSync, SYNC_DELAY } from '../sync/syncTrigger';
import type { OutboxDb } from '../sync/outbox';
import { generateId } from '../utils/id';
import { readDraft, writeDraft } from './draftJson';

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

export async function createManualEntry(
  db: OutboxDb,
  input: ManualEntryInput,
): Promise<{ inboxItemId: string; draft: Draft; isNewPayee: boolean }> {
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

  if (input.type === 'withdrawal' || input.type === 'deposit') {
    // The payee end starts as the typed text, marked new; a matching alias (unless the screen's
    // "new payee" was chosen explicitly) points it at the alias target instead.
    const typed: Draft =
      input.type === 'withdrawal'
        ? {
            ...shared,
            type: 'withdrawal',
            isNewPayee: true,
            sourceId: input.sourceId,
            sourceName: input.sourceName,
            destinationName: input.merchantRawInput,
          }
        : {
            ...shared,
            type: 'deposit',
            isNewPayee: true,
            sourceName: input.merchantRawInput,
            destinationId: input.destinationId,
            destinationName: input.destinationName,
          };
    draft = input.forceNewPayee ? typed : await resolvePayeeAlias(db, typed);
    isNewPayee = draft.isNewPayee;
  } else {
    // transfer: both ends are known asset accounts, no payee alias lookup at all (defect (1)).
    isNewPayee = false;
    draft = {
      ...shared,
      type: 'transfer',
      isNewPayee,
      sourceId: input.sourceId,
      sourceName: input.sourceName,
      destinationId: input.destinationId,
      destinationName: input.destinationName,
    };
  }

  const id = generateId();
  const now = new Date().toISOString();
  await db.insert(inboxItems).values({
    id,
    kind: 'manual_entry',
    state: 'captured',
    draftJson: writeDraft(draft),
    createdAt: now,
    updatedAt: now,
  });

  return { inboxItemId: id, draft, isNewPayee };
}

export interface ConfirmResult {
  outboxOperationId: string;
  previousState: InboxState;
}

export async function confirmInboxItem(db: OutboxDb, inboxItemId: string): Promise<ConfirmResult> {
  const rows = await db.select().from(inboxItems).where(eq(inboxItems.id, inboxItemId));
  const item = rows[0];
  if (!item) throw new Error(`inbox item ${inboxItemId} not found`);

  const previousState = item.state;
  const nextState = transition(previousState, 'confirm');
  const draft = readDraft(item.draftJson);

  const outboxOperationId = generateId();
  // One transaction: a failure between the two writes used to leave the item `confirmed` with no
  // operation behind it — out of the Inbox, never sent, and visible nowhere.
  db.transaction((tx) => {
    tx.update(inboxItems)
      .set({ state: nextState, errorMessage: null, updatedAt: new Date().toISOString() })
      .where(eq(inboxItems.id, inboxItemId))
      .run();
    enqueueOperationSync(tx, {
      id: outboxOperationId,
      inboxItemId,
      kind: 'create_transaction',
      payload: draftToTransactionPayload(inboxItemId, draft),
    });
  });
  requestSync(SYNC_DELAY.afterConfirm);
  return { outboxOperationId, previousState };
}

// Undo stays inside the same rule confirm itself follows (Global Constraints): it may delete a
// still-`pending` outbox operation, never touch one that already sent. `already_sent` means the
// operation moved past `pending` (in flight, done, or failed) between confirm and the tap. The
// delete is conditional on `pending` in the same statement, and replay claims an op the same
// way before sending it — so exactly one of the two wins, and a replay that loaded the queue
// before the tap skips the undone op instead of sending it.
export async function undoConfirm(
  db: OutboxDb,
  inboxItemId: string,
  undo: ConfirmResult,
): Promise<'undone' | 'already_sent'> {
  const removed = await db
    .delete(outboxOperations)
    .where(
      and(
        eq(outboxOperations.id, undo.outboxOperationId),
        // Waiting, or waiting to be retried after a failed attempt: either way not on its way.
        inArray(outboxOperations.status, ['pending', 'failed']),
      ),
    )
    .returning({ id: outboxOperations.id });
  if (removed.length === 0) return 'already_sent';
  await db
    .update(inboxItems)
    .set({ state: undo.previousState, updatedAt: new Date().toISOString() })
    .where(eq(inboxItems.id, inboxItemId));
  return 'undone';
}
