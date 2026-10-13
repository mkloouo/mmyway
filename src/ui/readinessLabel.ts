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
