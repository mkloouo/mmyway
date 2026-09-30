// One cash-count adjustment (design §6.9): a withdrawal to the shortfall payee or a deposit from
// the surplus payee, created as a manual entry and confirmed at once — the review sheet on the
// Count screen is the confirmation.
import { inboxItems } from '../db/schema';
import type { Draft } from '../inbox/draft';
import { writeDraft } from '../inbox/draftJson';
import { confirmInboxItem } from '../inbox/createManualEntry';
import type { OutboxDb } from '../sync/outbox';
import { generateId } from '../utils/id';
import i18n from '../i18n';
import type { SweepAdjustment } from './sweep';

export async function createAndConfirmAdjustment(
  db: OutboxDb,
  adjustment: SweepAdjustment,
  settings: {
    shortfallAccountId: string | null;
    surplusAccountId: string | null;
    categoryName: string | null;
  },
): Promise<void> {
  const isWithdrawal = adjustment.type === 'withdrawal';
  const payeeAccountId = isWithdrawal ? settings.shortfallAccountId : settings.surplusAccountId;
  if (!payeeAccountId) throw new Error('reconcile payee account is not configured');

  const now = new Date().toISOString();
  const draft: Draft = {
    type: adjustment.type,
    amount: adjustment.amount,
    currencyCode: adjustment.currencyCode,
    date: now,
    description: i18n.t('count.title'),
    isNewPayee: false,
    sourceId: isWithdrawal ? adjustment.accountId : payeeAccountId,
    destinationId: isWithdrawal ? payeeAccountId : adjustment.accountId,
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
