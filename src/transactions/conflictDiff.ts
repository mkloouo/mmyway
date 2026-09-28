// The conflict screen's comparison: one row per field the queued change touches, the server's
// current value beside the queued one. The server side is the copy the outbox stored when it
// detected the conflict (src/sync/outbox.ts), so it reflects what changed in FF3.
import type { cachedTransactions } from '../db/schema';
import i18n, { appLocale } from '../i18n';

type CachedRow = typeof cachedTransactions.$inferSelect;

export interface ConflictField {
  label: string;
  server: string;
  mine: string;
  differs: boolean;
}

export interface ConflictLookups {
  accountName: (id: string) => string | undefined;
  budgetName: (id: string) => string | undefined;
  money: (amount: string) => string;
}

const EMPTY = '—';

function text(value: unknown): string {
  if (value === null || value === undefined || value === '') return EMPTY;
  return String(value);
}

function dateLabel(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(appLocale(), {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}

function tagsOf(json: string | null | undefined): string[] {
  try {
    return JSON.parse(json ?? '[]');
  } catch {
    return [];
  }
}

export function conflictFields(
  changes: Record<string, unknown>,
  row: CachedRow,
  lookups: ConflictLookups,
): ConflictField[] {
  const fields: ConflictField[] = [];
  const add = (label: string, server: string, mine: string) =>
    fields.push({ label, server, mine, differs: server !== mine });

  for (const [key, value] of Object.entries(changes)) {
    switch (key) {
      case 'amount':
        add(i18n.t('fields.amount'), lookups.money(row.amount), lookups.money(String(value)));
        break;
      case 'description':
        add(i18n.t('fields.description'), text(row.description), text(value));
        break;
      case 'notes':
        add(i18n.t('fields.note'), text(row.notes), text(value));
        break;
      case 'category_name':
        add(i18n.t('fields.category'), text(row.categoryName), text(value));
        break;
      case 'date':
        add(i18n.t('fields.date'), dateLabel(row.date), dateLabel(String(value)));
        break;
      case 'source_id':
        add(
          i18n.t('fields.from'),
          text(row.sourceName),
          text(lookups.accountName(String(value)) ?? value),
        );
        break;
      case 'destination_id':
        add(
          i18n.t('fields.to'),
          text(row.destinationName),
          text(lookups.accountName(String(value)) ?? value),
        );
        break;
      case 'budget_id':
        add(
          i18n.t('fields.budget'),
          text(row.budgetName),
          text(lookups.budgetName(String(value)) ?? value),
        );
        break;
      case 'tags':
        add(
          i18n.t('fields.tags'),
          tagsOf(row.tagsJson).join(', ') || EMPTY,
          (value as string[] | undefined)?.join(', ') || EMPTY,
        );
        break;
      case 'currency_code':
        add(i18n.t('fields.currency'), text(row.currencyCode), text(value));
        break;
      default:
        add(key, EMPTY, text(typeof value === 'object' ? JSON.stringify(value) : value));
    }
  }
  return fields;
}
