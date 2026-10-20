import { appLocale } from '../i18n';

function toDate(value: Date | string): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (!value) return null;
  // If YYYY-MM-DD, parse as midday to prevent timezone shift across local day boundaries
  const d =
    value.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T12:00:00`)
      : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "5 Mar" — short month and day. Falls back to original string on invalid date. */
export function shortDay(value: Date | string): string {
  const d = toDate(value);
  return d ? d.toLocaleDateString(appLocale(), { month: 'short', day: 'numeric' }) : String(value);
}

/** "5 Mar 2026" — numeric day, short month, full year. */
export function fullDay(value: Date | string): string {
  const d = toDate(value);
  return d
    ? d.toLocaleDateString(appLocale(), { day: 'numeric', month: 'short', year: 'numeric' })
    : String(value);
}

/** "Mon 5 Mar" — short weekday, numeric day, short month. */
export function weekdayDay(value: Date | string): string {
  const d = toDate(value);
  return d
    ? d.toLocaleDateString(appLocale(), { weekday: 'short', day: 'numeric', month: 'short' })
    : String(value);
}

/** "5 March" — numeric day, full month. */
export function monthDay(value: Date | string): string {
  const d = toDate(value);
  return d ? d.toLocaleDateString(appLocale(), { day: 'numeric', month: 'long' }) : String(value);
}

/** "March 2026" — full month and year. */
export function monthYear(value: Date | string): string {
  const d = toDate(value);
  return d ? d.toLocaleDateString(appLocale(), { month: 'long', year: 'numeric' }) : String(value);
}

/** Monday is ISO weekday 1, and 2024-01-01 was a Monday — names from Intl using appLocale. */
export function weekdayName(weekday: number, width: 'long' | 'short' = 'long'): string {
  const date = new Date(Date.UTC(2024, 0, 1 + ((Math.trunc(weekday) - 1 + 7) % 7)));
  return date.toLocaleDateString(appLocale(), { weekday: width, timeZone: 'UTC' });
}

/** "Monday" — full weekday name of a date. */
export function weekdayOf(value: Date | string, width: 'long' | 'short' = 'long'): string {
  const d = toDate(value);
  return d ? d.toLocaleDateString(appLocale(), { weekday: width }) : String(value);
}

/** "5 Mar 2026, 14:30" — date with 2-digit time. */
export function dateTime(value: Date | string): string {
  const d = toDate(value);
  return d
    ? d.toLocaleString(appLocale(), {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : String(value);
}
