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
  sourceName: string | null;
  destinationName: string | null;
  categoryName: string | null;
}

export function mapRemoteResult(group: TransactionRead): RemoteResultRow | null {
  const journal = group.attributes.transactions[0];
  if (!journal) return null;
  return {
    remote: true,
    group,
    groupId: group.id,
    description: journal.description,
    amount: journal.amount,
    currencyCode: journal.currency_code ?? '',
    type: journal.type as ActivityRowType,
    sourceName: journal.source_name ?? null,
    destinationName: journal.destination_name ?? null,
    categoryName: journal.category_name ?? null,
  };
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

/** Split lines shown under a split transaction's row before "+N more". */
export const MAX_SPLIT_LINES = 3;
/** The section holding what FF3's own search answered with, rather than a day of cached rows. */
export const REMOTE_SECTION_KEY = 'ff3-search';
