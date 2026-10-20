// Pure mapping from a receipt extraction to one or more drafts.
import { referenceCategories, referenceCurrencies } from '../db/schema';
import { getDefaultSourceAccountId, getCashAccountId } from '../settings/appSettings';
import type { OutboxDb } from '../sync/outbox';
import type { Draft } from '../inbox/draft';
import type { ReceiptExtraction } from './types';
import i18n from '../i18n';

// Below this confidence, guessing a field the model wasn't sure about does more harm than
// leaving it blank for the user to fill in on the draft screen.
export const LOW_CONFIDENCE_THRESHOLD = 0.4;

export interface ReceiptDraftReference {
  categoryNames: string[];
  currencyCodes: string[];
  cashAccountId?: string;
  cardAccountId?: string;
}

export async function buildReceiptDraftReference(db: OutboxDb): Promise<ReceiptDraftReference> {
  const [categories, currencies, defaultAccountId, cashAccountId] = await Promise.all([
    db.select().from(referenceCategories),
    db.select().from(referenceCurrencies),
    getDefaultSourceAccountId(db),
    getCashAccountId(db),
  ]);
  return {
    categoryNames: categories.map((c) => c.name),
    currencyCodes: currencies.map((c) => c.code),
    // Falls back to leaving the source blank — never a guess — when nothing is configured
    // (design §6.6's DEFAULTS row: "Cash payments use ␣").
    cashAccountId: cashAccountId ?? undefined,
    cardAccountId: defaultAccountId ?? undefined,
  };
}

// Fields the provider still populated despite an overall confidence below threshold (design
// §6.3). Currency and category aren't listed here — an untrusted currency or an unrecognized
// category is already blanked outright, rather than shown-but-flagged.
export function lowConfidenceFields(extraction: ReceiptExtraction): string[] | undefined {
  if (extraction.confidence >= LOW_CONFIDENCE_THRESHOLD) return undefined;
  const fields: string[] = [];
  if (extraction.amount) fields.push('amount');
  if (extraction.merchant) fields.push('payee');
  if (extraction.date) fields.push('date');
  return fields.length > 0 ? fields : undefined;
}

// A receipt's printed date and time are wall-clock time where it was printed — the device's zone,
// in practice. Building the ISO string by hand with a `Z` suffix treated 23:30 in Warsaw as 23:30
// UTC, which is 01:30 the next day there. No time: noon, so no zone offset can move the day.
export function receiptLocalDate(date: string, time: string | null): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time ? time.split(':').map(Number) : [12, 0];
  return new Date(y!, m! - 1, d!, hh!, mm!);
}

/**
 * When the receipt was paid: its printed date and time; else, for a printed date without a time,
 * the photo's time when it was taken that day (noon otherwise); else when the photo was taken.
 * `takenAt` is the photo's own time, or when it was captured — never the time it was read, which
 * can be hours later after an offline stretch.
 */
export function receiptDate(
  extraction: Pick<ReceiptExtraction, 'date' | 'time'>,
  takenAt: Date,
): Date {
  if (!extraction.date) return takenAt;
  const printed = receiptLocalDate(extraction.date, extraction.time);
  if (extraction.time) return printed;
  const sameDay =
    printed.getFullYear() === takenAt.getFullYear() &&
    printed.getMonth() === takenAt.getMonth() &&
    printed.getDate() === takenAt.getDate();
  return sameDay ? takenAt : printed;
}

// Maps a receipt extraction onto a draft. Never throws on a field it doesn't recognize —
// normalizeExtraction (src/receipt/providers/local.ts) already dropped anything unexpected;
// this only has to cope with values it can't trust (unsynced currency, low confidence).
export function isZeroAmount(amount: string): boolean {
  return /^0+(\.0+)?$/.test(amount);
}

// Maps a receipt extraction onto one or more drafts. Currency exchange receipts create a transfer
// draft for each exchange, plus dedicated withdrawal drafts for any fees charged. Standard receipts
// create a single withdrawal draft.
export function receiptToDrafts(
  extraction: ReceiptExtraction,
  reference: ReceiptDraftReference,
  takenAt: Date,
): Draft[] {
  if (extraction.currencyExchanges && extraction.currencyExchanges.length > 0) {
    const drafts: Draft[] = [];
    const date = receiptDate(extraction, takenAt).toISOString();
    const category =
      extraction.category && reference.categoryNames.includes(extraction.category)
        ? extraction.category
        : undefined;
    const sourceId =
      extraction.paymentMethod === 'cash'
        ? reference.cashAccountId
        : extraction.paymentMethod === 'card'
          ? reference.cardAccountId
          : undefined;

    for (const exchange of extraction.currencyExchanges) {
      const fromTrusted =
        !!exchange.fromCurrency &&
        reference.currencyCodes.includes(exchange.fromCurrency) &&
        extraction.confidence >= LOW_CONFIDENCE_THRESHOLD;
      const toTrusted =
        !!exchange.toCurrency &&
        reference.currencyCodes.includes(exchange.toCurrency) &&
        extraction.confidence >= LOW_CONFIDENCE_THRESHOLD;

      const pair =
        exchange.fromCurrency && exchange.toCurrency
          ? `${exchange.fromCurrency} → ${exchange.toCurrency}`
          : '';
      const transferDesc = extraction.merchant
        ? pair
          ? `${extraction.merchant} (${pair})`
          : extraction.merchant
        : pair || i18n.t('draft.currencyExchange');

      const lowConf: string[] = [];
      if (extraction.confidence < LOW_CONFIDENCE_THRESHOLD) {
        if (exchange.fromAmount) lowConf.push('amount');
        if (exchange.toAmount) lowConf.push('foreignAmount');
        if (extraction.merchant) lowConf.push('payee');
        if (extraction.date) lowConf.push('date');
      }

      drafts.push({
        type: 'transfer',
        amount: exchange.fromAmount ?? '',
        currencyCode: fromTrusted ? exchange.fromCurrency! : '',
        foreignAmount: exchange.toAmount ?? undefined,
        foreignCurrencyCode: toTrusted ? exchange.toCurrency! : (exchange.toCurrency ?? undefined),
        date,
        description: transferDesc,
        sourceId,
        isNewPayee: false,
        categoryName: category,
        lowConfidenceFields: lowConf.length > 0 ? lowConf : undefined,
      });

      if (exchange.feeAmount && !isZeroAmount(exchange.feeAmount)) {
        const feeCurr = exchange.feeCurrency ?? exchange.fromCurrency;
        const feeCurrTrusted =
          !!feeCurr &&
          reference.currencyCodes.includes(feeCurr) &&
          extraction.confidence >= LOW_CONFIDENCE_THRESHOLD;

        const feeLowConf: string[] = [];
        if (extraction.confidence < LOW_CONFIDENCE_THRESHOLD) {
          if (exchange.feeAmount) feeLowConf.push('amount');
          if (extraction.merchant) feeLowConf.push('payee');
          if (extraction.date) feeLowConf.push('date');
        }

        const feeDesc = extraction.merchant
          ? `${extraction.merchant} - ${i18n.t('draft.exchangeFee')}`
          : i18n.t('draft.exchangeFee');

        drafts.push({
          type: 'withdrawal',
          amount: exchange.feeAmount,
          currencyCode: feeCurrTrusted ? feeCurr! : '',
          date,
          description: feeDesc,
          destinationName: extraction.merchant ?? undefined,
          isNewPayee: true,
          categoryName: category,
          sourceId,
          lowConfidenceFields: feeLowConf.length > 0 ? feeLowConf : undefined,
        });
      }
    }

    if (drafts.length > 0) return drafts;
  }

  const category =
    extraction.category && reference.categoryNames.includes(extraction.category)
      ? extraction.category
      : undefined;
  const currencyTrusted =
    !!extraction.currency &&
    reference.currencyCodes.includes(extraction.currency) &&
    extraction.confidence >= LOW_CONFIDENCE_THRESHOLD;
  const sourceId =
    extraction.paymentMethod === 'cash'
      ? reference.cashAccountId
      : extraction.paymentMethod === 'card'
        ? reference.cardAccountId
        : undefined;
  const notes =
    extraction.items.length > 0
      ? extraction.items.map((item) => `${item.count}x ${item.title} (${item.price})`).join('\n')
      : undefined;
  const date = receiptDate(extraction, takenAt).toISOString();

  return [
    {
      type: 'withdrawal',
      amount: extraction.amount ?? '',
      currencyCode: currencyTrusted ? extraction.currency! : '',
      date,
      description: extraction.merchant ?? i18n.t('draft.receipt'),
      destinationName: extraction.merchant ?? undefined,
      isNewPayee: true, // a payee alias (parseReceiptItem) or the draft screen's payee picker corrects this
      categoryName: category,
      sourceId,
      notes,
      lowConfidenceFields: lowConfidenceFields(extraction),
    },
  ];
}

export function receiptToDraft(
  extraction: ReceiptExtraction,
  reference: ReceiptDraftReference,
  takenAt: Date,
): Draft {
  return receiptToDrafts(extraction, reference, takenAt)[0]!;
}
