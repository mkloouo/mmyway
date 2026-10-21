import { localDay } from '../utils/day';
import { landingItems, matchesActivityFilter } from './pinnedRows';
import {
  landingRow,
  REMOTE_SECTION_KEY,
  type ActivityCachedRow,
  type ActivityItem,
  type DisplaySection,
  type QueuedRow,
  type RemoteResultRow,
} from './activityRows';
import { applyPendingEdit, type PendingEdits } from './pendingEdits';
import type { ActivityTypeFilter, CachedTransactionRow } from './useTransactionPage';
import type { DaySection } from './groupByDay';
import type { CacheFacts, SentItemRow } from './useActivityRows';

export interface BuildDisplaySectionsParams {
  sections: readonly DaySection<CachedTransactionRow>[];
  queuedRows: readonly QueuedRow[];
  sentItems: readonly SentItemRow[] | null;
  cacheFacts: CacheFacts | null;
  pendingDeletes: ReadonlySet<string>;
  edits: PendingEdits;
  rowKey: (row: ActivityItem) => string;
  type: ActivityTypeFilter;
  accountFilter: string | null;
  search: string;
  remoteRows: readonly RemoteResultRow[] | null;
  todayKey?: string;
}

export function buildDisplaySections(params: BuildDisplaySectionsParams): DisplaySection[] {
  const {
    sections,
    queuedRows,
    sentItems,
    cacheFacts,
    pendingDeletes,
    edits,
    rowKey,
    type,
    accountFilter,
    search,
    remoteRows,
    todayKey = localDay(),
  } = params;

  const queuedInbox = new Set(queuedRows.map((r) => r.inboxItemId));
  const landingRows: QueuedRow[] = landingItems(sentItems ?? [], cacheFacts, queuedInbox)
    .map((i) => landingRow(i.id, i.draftJson))
    .filter((r): r is QueuedRow => !!r);

  // Pinned rows follow the same filters as the cached ones: they used to show under every account.
  const filter = { type, accountId: accountFilter, search };

  // The live queries behind the pinned rows and the cached ones update on separate ticks, so
  // for a moment after a send both can hold the same entry — two rows under one key. The cached
  // row wins.
  const cachedKeys = new Set(
    sections.flatMap((s) => s.data.map((row) => rowKey(row))).filter((k) => k.startsWith('inbox:')),
  );
  const pinned = [...queuedRows, ...landingRows].filter(
    (row) => !cachedKeys.has(rowKey(row)) && matchesActivityFilter(row, filter),
  );

  const result: DisplaySection[] = sections
    .map((s): DisplaySection => ({
      key: s.key,
      totals: s.totals,
      data: s.data
        .filter((row) => !pendingDeletes.has(row.groupId))
        // An edit saved here shows its new values, marked queued until FF3 has it.
        .map((row): ActivityCachedRow => {
          const pending = applyPendingEdit(row, edits);
          return pending ? { ...pending.row, pendingStatus: pending.status } : row;
        }),
    }))
    .filter((s) => s.data.length > 0);

  if (pinned.length > 0) {
    const idx = result.findIndex((s) => s.key === todayKey);
    if (idx >= 0) {
      result[idx] = { ...result[idx]!, data: [...pinned, ...result[idx]!.data] };
    } else {
      result.unshift({ key: todayKey, totals: [], data: pinned });
    }
  }

  if (remoteRows && remoteRows.length > 0) {
    const existingGroupIds = new Set(result.flatMap((s) => s.data.map((row) => row.groupId)));
    const extraRemoteRows = remoteRows.filter(
      (r) =>
        !existingGroupIds.has(r.groupId) &&
        (type === 'all' || r.type === type) &&
        (!accountFilter || r.sourceId === accountFilter || r.destinationId === accountFilter),
    );
    if (extraRemoteRows.length > 0) {
      result.push({ key: REMOTE_SECTION_KEY, totals: [], data: extraRemoteRows });
    }
  }

  return result;
}

export type RemoteSearchStatus = 'idle' | 'loading' | 'done' | 'offline' | 'error';

export function getSearchFooter(
  status: RemoteSearchStatus,
  hasRemoteSection: boolean,
): { key: string; warn?: boolean } | null {
  if (status === 'loading') return { key: 'activity.searching' };
  if (status === 'offline') return { key: 'activity.searchOffline' };
  if (status === 'error') return { key: 'activity.searchFailed', warn: true };
  if (status === 'done' && !hasRemoteSection) return { key: 'activity.nothingMore' };
  return null;
}
