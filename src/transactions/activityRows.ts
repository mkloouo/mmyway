// The row shapes Activity lists, and the pure functions that build them: an entry still on its way
// to FF3, a result FF3 answered a search with, and a cached split transaction's lines. Kept out of
// the screen so the screen is the list and its state, not the data shapes too.
import { addDecimal } from '../api/ff3/decimal';
import type { TransactionRead, TransactionSplit } from '../api/ff3/types';
import { readDraft } from '../inbox/draftJson';
import { draftTotal } from '../inbox/draftSplits';
import { readSplits } from './splitsJson';
import type { CachedTransactionRow } from './useTransactionPage';
import type { PendingEditStatus } from './pendingEdits';
import type { referenceCurrencies } from '../db/schema';

export type ActivityRowType = 'withdrawal' | 'deposit' | 'transfer';

/** One split under a split transaction's row: basic info only. */
export interface SplitLine {
  label: string;
  amount: string;
  categoryName: string | null;
}

export interface QueuedRow {
  queued: true;
  /** Sent, and waiting only for its synced copy to reach the list (no "Queued" chip). */
  landing?: boolean;
  groupId: string;
  inboxItemId: string | null;
  description: string;
  amount: string;
  currencyCode: string;
  type: ActivityRowType;
  /** FF3 account ids, for the account filter (a payee typed as new has none yet). */
  sourceId: string | null;
  destinationId: string | null;
  sourceName: string | null;
  destinationName: string | null;
  categoryName: string | null;
  splits: SplitLine[];
}

export interface RemoteResultRow {
  remote: true;
  /** The full FF3 answer, cached on tap so the detail screen (which reads the cache) can open it. */
  group: TransactionRead;
  groupId: string;
  description: string;
  amount: string;
  currencyCode: string;
  type: ActivityRowType;
  sourceId: string | null;
  destinationId: string | null;
  sourceName: string | null;
  destinationName: string | null;
  categoryName: string | null;
}

export function mapRemoteResult(group: TransactionRead): RemoteResultRow | null {
  const splits = group.attributes.transactions;
  const journal = splits[0];
  if (!journal) return null;
  const { amount, description } = groupHeadline(group);
  const extra = journal as {
    source_id?: string | number | null;
    destination_id?: string | number | null;
  };
  return {
    remote: true,
    group,
    groupId: group.id,
    description,
    amount,
    currencyCode: journal.currency_code ?? '',
    type: journal.type as ActivityRowType,
    sourceId: extra.source_id != null ? String(extra.source_id) : null,
    destinationId: extra.destination_id != null ? String(extra.destination_id) : null,
    sourceName: journal.source_name ?? null,
    destinationName: journal.destination_name ?? null,
    categoryName: splits.length > 1 ? null : (journal.category_name ?? null),
  };
}

/**
 * A split group as one line: the splits' total when they share a currency (otherwise the first
 * split's amount, as there is no single total), under the group's title. Needs at least one split.
 */
export function groupHeadline(group: TransactionRead): { amount: string; description: string } {
  const splits = group.attributes.transactions;
  const journal = splits[0]!;
  const sameCurrency = splits.every((s) => s.currency_code === journal.currency_code);
  const amount = splits.length > 1 && sameCurrency ? sumAmounts(splits) : journal.amount;
  const groupTitle = (group.attributes as { group_title?: string | null }).group_title;
  const description = splits.length > 1 && groupTitle ? groupTitle : journal.description;
  return { amount, description };
}

export function sumAmounts(splits: TransactionSplit[]): string {
  return splits.map((s) => s.amount).reduce((a, b) => addDecimal(a, b));
}

/** A sent entry, from its draft, while its synced copy is on its way into the list. */
export function landingRow(inboxItemId: string, draftJson: string): QueuedRow | null {
  try {
    const d = readDraft(draftJson);
    const extras = d.extraSplits ?? [];
    return {
      queued: true,
      landing: true,
      groupId: `landing:${inboxItemId}`,
      inboxItemId,
      description: extras.length ? d.groupTitle || d.description : d.description,
      amount: draftTotal(d),
      currencyCode: d.currencyCode,
      type: d.type,
      sourceId: d.sourceId ?? null,
      destinationId: d.destinationId ?? null,
      sourceName: d.sourceName ?? null,
      destinationName: d.destinationName ?? null,
      categoryName: extras.length ? null : (d.categoryName ?? null),
      splits: extras.length
        ? [
            {
              label: d.categoryName || d.description,
              amount: d.amount,
              categoryName: d.categoryName ?? null,
            },
            ...extras.map((s) => ({
              label: s.categoryName || s.description,
              amount: s.amount,
              categoryName: s.categoryName ?? null,
            })),
          ]
        : [],
    };
  } catch {
    return null;
  }
}

/** A cached split transaction's splits, for the lines under its row. */
export function cachedSplitLines(row: CachedTransactionRow): SplitLine[] {
  if (row.splitCount < 2) return [];
  return (readSplits(row.splitsJson) ?? []).map((s) => ({
    label: s.categoryName || s.description,
    amount: s.amount,
    categoryName: s.categoryName,
  }));
}

/** A cached row, plus the state of any edit to it that is saved here but not yet in FF3. */
export type ActivityCachedRow = CachedTransactionRow & { pendingStatus?: PendingEditStatus };
export type ActivityItem = ActivityCachedRow | QueuedRow | RemoteResultRow;

export interface DisplaySection {
  key: string;
  totals: { currencyCode: string; amount: string }[];
  data: ActivityItem[];
}

export type Currencies = (typeof referenceCurrencies.$inferSelect)[];

/** The section holding what FF3's own search answered with, rather than a day of cached rows. */
export const REMOTE_SECTION_KEY = 'ff3-search';
