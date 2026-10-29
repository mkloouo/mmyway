// "Needs amount, payee" for a draft that can't be confirmed yet (src/inbox/readiness.ts keeps the
// missing fields as plain English ids; this turns them into the app's language).
import i18n from '../i18n';

const MISSING_KEYS: Record<string, string> = {
  amount: 'amount',
  currency: 'currency',
  'converted amount': 'convertedAmount',
  'source account': 'sourceAccount',
  'destination account': 'destinationAccount',
  payee: 'payee',
  'split amount': 'splitAmount',
  'split payee': 'splitPayee',
  'split total': 'splitTotal',
};

function fieldList(missing: string[], forHint = false): string {
  return missing
    .map((m) => {
      if (m === 'description' || m === 'split description') return i18n.t('fields.description');
      if (forHint && m === 'payee') {
        return i18n.t('readiness.payeeForHint', { defaultValue: 'a payee' });
      }
      return MISSING_KEYS[m] ? i18n.t(`readiness.${MISSING_KEYS[m]}`) : m;
    })
    .join(', ');
}

export function needsLabel(missing: string[]): string {
  return i18n.t('readiness.needs', { fields: fieldList(missing) });
}

export function needsToConfirmLabel(missing: string[]): string {
  return i18n.t('readiness.needsToConfirm', { fields: fieldList(missing, true) });
}

export function missingLabel(missing: string[]): string {
  return i18n.t('readiness.missing', { fields: fieldList(missing) });
}

/**
 * Short actionable hint when confirm/save is blocked (Board 13).
 * Prioritizes payee first, then account, then amount.
 */
export function blockedConfirmHint(missing: string[]): string {
  if (missing.includes('payee') || missing.includes('split payee')) {
    return i18n.t('readiness.addPayeeFirst');
  }
  if (missing.includes('source account') || missing.includes('destination account')) {
    return i18n.t('readiness.pickAccountFirst');
  }
  if (missing.includes('amount') || missing.includes('split amount')) {
    return i18n.t('readiness.enterAmountFirst');
  }
  return needsToConfirmLabel(missing);
}
