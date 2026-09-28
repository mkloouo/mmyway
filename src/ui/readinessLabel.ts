// "Needs amount, payee" for a draft that can't be confirmed yet (src/inbox/readiness.ts keeps the
// missing fields as plain English ids; this turns them into the app's language).
import i18n from '../i18n';

const MISSING_KEYS: Record<string, string> = {
  amount: 'amount',
  currency: 'currency',
  'source account': 'sourceAccount',
  'destination account': 'destinationAccount',
  payee: 'payee',
};

function fieldList(missing: string[]): string {
  return missing.map((m) => (MISSING_KEYS[m] ? i18n.t(`readiness.${MISSING_KEYS[m]}`) : m)).join(', ');
}

export function needsLabel(missing: string[]): string {
  return i18n.t('readiness.needs', { fields: fieldList(missing) });
}

export function missingLabel(missing: string[]): string {
  return i18n.t('readiness.missing', { fields: fieldList(missing) });
}
