// Currencies as the pickers should see them: FF3 lists every currency it knows (BTC, and dozens
// more), but only the ones enabled there are in use. A code already chosen stays offered even if
// it was disabled since, so a picker never hides the current value.
import type { referenceCurrencies } from '../db/schema';

type CurrencyRow = typeof referenceCurrencies.$inferSelect;

export function pickableCurrencies(rows: CurrencyRow[] | undefined, selected?: string | null): CurrencyRow[] {
  return (rows ?? [])
    .filter((c) => c.enabled || c.code === selected)
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.code.localeCompare(b.code));
}

/** FF3's primary currency, the fallback when Settings → Default currency isn't set. */
export function primaryCurrencyCode(rows: CurrencyRow[] | undefined): string | null {
  return (rows ?? []).find((c) => c.isDefault)?.code ?? null;
}
