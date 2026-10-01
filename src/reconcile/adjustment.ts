// One cash-count adjustment (design §6.9): a withdrawal to the shortfall payee or a deposit from
// the surplus payee, created as a manual entry and confirmed at once — the review sheet on the
// Count screen is the confirmation.
import { inboxItems } from '../db/schema';
import type { Draft } from '../inbox/draft';
import { writeDraft } from '../inbox/draftJson';
import { confirmInboxItem } from '../inbox/createManualEntry';
import type { OutboxDb } from '../sync/outbox';
import { generateId } from '../utils/id';
import type { SweepAdjustment } from './sweep';

export const DEFAULT_SHORTFALL_PAYEE = 'Cash shortfall';
export const DEFAULT_SURPLUS_PAYEE = 'Cash surplus';

export async function createAndConfirmAdjustment(
  db: OutboxDb,
  adjustment: SweepAdjustment,
  settings: {
    shortfallAccountId?: string | null;
    surplusAccountId?: string | null;
    shortfallAccountName?: string | null;
    surplusAccountName?: string | null;
    categoryName?: string | null;
  } = {},
): Promise<void> {
  const isWithdrawal = adjustment.type === 'withdrawal';
  const payeeAccountId = isWithdrawal ? settings.shortfallAccountId : settings.surplusAccountId;
  const defaultPayeeName = isWithdrawal
    ? settings.shortfallAccountName || DEFAULT_SHORTFALL_PAYEE
    : settings.surplusAccountName || DEFAULT_SURPLUS_PAYEE;

  const now = new Date().toISOString();
  const draft: Draft = {
    type: adjustment.type,
    amount: adjustment.amount,
    currencyCode: adjustment.currencyCode,
    date: now,
    description: 'Cash count',
    isNewPayee: !payeeAccountId,
    sourceId: isWithdrawal ? adjustment.accountId : (payeeAccountId ?? undefined),
    sourceName: !isWithdrawal && !payeeAccountId ? defaultPayeeName : undefined,
    destinationId: isWithdrawal ? (payeeAccountId ?? undefined) : adjustment.accountId,
    destinationName: isWithdrawal && !payeeAccountId ? defaultPayeeName : undefined,
    categoryName: settings.categoryName || undefined,
    extraTags: ['mmyway-reconcile'],
  };
  const id = generateId();
  await db.insert(inboxItems).values({
    id,
    kind: 'manual_entry',
    state: 'captured',
    draftJson: writeDraft(draft),
    createdAt: now,
    updatedAt: now,
  });
  await confirmInboxItem(db, id);
}
