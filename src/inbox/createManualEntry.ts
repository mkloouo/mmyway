import { and, eq } from 'drizzle-orm';
import { inboxItems, outboxOperations, referenceAccounts } from '../db/schema';
import { resolvePayeeAlias } from '../lookup/aliases';
import { transition, type InboxState } from './state';
import { draftToTransactionPayload, type Draft, type DraftLocation } from './draft';
import { bookingLegAccountId } from './fx';
import { enqueueOperationSync, neverSent } from '../sync/outbox';
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
  // The screen's "new payee" checkbox (brief §3.4: new payee stays explicit).
  forceNewPayee?: boolean;
  sourceId?: string; // asset account id: source for withdrawal/transfer
  sourceName?: string;
  destinationId?: string; // asset account id: destination for deposit/transfer
  destinationName?: string;
  categoryName?: string;
  budgetId?: string;
  notes?: string;
  tags?: string[];
  foreignAmount?: string;
  foreignCurrencyCode?: string;
  sharedWith?: string;
  /** Where the entry was made, when a fix had arrived by the time it was saved (#67). */
  location?: DraftLocation;
}

export async function createManualEntry(
  db: OutboxDb,
  input: ManualEntryInput,
  options: { confirm?: boolean; receiptImagePath?: string } = {},
): Promise<{ inboxItemId: string; draft: Draft; isNewPayee: boolean; confirmed?: ConfirmResult }> {
  const shared = {
    amount: input.amount,
    currencyCode: input.currencyCode,
    date: input.date,
    description: input.description,
    categoryName: input.categoryName,
    budgetId: input.budgetId,
    notes: input.notes,
    extraTags: input.tags?.length ? input.tags : undefined,
    foreignAmount: input.foreignAmount,
    foreignCurrencyCode: input.foreignCurrencyCode,
    sharedWith: input.sharedWith,
    location: input.location,
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
  const confirmed = db.transaction((tx) => {
    tx.insert(inboxItems)
      .values({
        id,
        kind: 'manual_entry',
        state: 'captured',
        draftJson: writeDraft(draft),
        receiptImagePath: options.receiptImagePath,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return options.confirm ? confirmInTransaction(tx, id) : undefined;
  });
  if (confirmed) requestSync(SYNC_DELAY.afterConfirm);
  return { inboxItemId: id, draft, isNewPayee, confirmed };
}

export interface ConfirmResult {
  outboxOperationId: string;
  previousState: InboxState;
}

/** Both confirmation entry points call this inside their own synchronous transaction. */
function confirmInTransaction(tx: OutboxDb, inboxItemId: string): ConfirmResult {
  const rows = tx.select().from(inboxItems).where(eq(inboxItems.id, inboxItemId)).all();
  const item = rows[0];
  if (!item) throw new Error(`inbox item ${inboxItemId} not found`);

  const previousState = item.state;
  const nextState = transition(previousState, 'confirm');
  const draft = readDraft(item.draftJson);
  // FF3 books `amount` in the asset leg's own currency and ignores a `currency_code` saying
  // otherwise, so the entry's two figures are put the right way round here — the one place every
  // draft, from Capture or a receipt, is queued (src/inbox/fx.ts).
  const legId = bookingLegAccountId(draft);
  const [leg] = legId
    ? tx
        .select({ currencyCode: referenceAccounts.currencyCode })
        .from(referenceAccounts)
        .where(eq(referenceAccounts.id, legId))
        .all()
    : [];

  const outboxOperationId = generateId();
  // One transaction: a failure between the two writes used to leave the item `confirmed` with no
  // operation behind it — out of the Inbox, never sent, and visible nowhere.
  tx.update(inboxItems)
    .set({ state: nextState, errorMessage: null, updatedAt: new Date().toISOString() })
    .where(eq(inboxItems.id, inboxItemId))
    .run();
  enqueueOperationSync(tx, {
    id: outboxOperationId,
    inboxItemId,
    kind: 'create_transaction',
    payload: draftToTransactionPayload(inboxItemId, draft, leg?.currencyCode),
  });
  return { outboxOperationId, previousState };
}

export async function confirmInboxItem(db: OutboxDb, inboxItemId: string): Promise<ConfirmResult> {
  const result = db.transaction((tx) => confirmInTransaction(tx, inboxItemId));
  requestSync(SYNC_DELAY.afterConfirm);
  return result;
}

// Undo stays inside the same rule confirm itself follows (Global Constraints): it may delete a
// still-`pending` outbox operation, never touch one that already sent. `already_sent` means the
// operation moved past a first `pending` (in flight, done, or attempted) between confirm and the tap. The
// delete is conditional on `pending` in the same statement, and replay claims an op the same
// way before sending it — so exactly one of the two wins, and a replay that loaded the queue
// before the tap skips the undone op instead of sending it.
export async function undoConfirm(
  db: OutboxDb,
  inboxItemId: string,
  undo: ConfirmResult,
): Promise<'undone' | 'already_sent'> {
  return db.transaction((tx) => {
    const removed = tx
      .delete(outboxOperations)
      .where(
        // Only a create that never left the device: one that was attempted may already be in FF3
        // (the answer lost), and Cancel — which asks FF3 first — is the way out of that.
        and(eq(outboxOperations.id, undo.outboxOperationId), neverSent()),
      )
      .returning({ id: outboxOperations.id })
      .all();
    if (removed.length === 0) return 'already_sent';
    tx.update(inboxItems)
      .set({ state: undo.previousState, updatedAt: new Date().toISOString() })
      .where(eq(inboxItems.id, inboxItemId))
      .run();
    return 'undone';
  });
}
