// What a queued change (an outbox operation) is about, for the Inbox's Queued and Needs attention
// cards: the thing it changes, by name, and the screen that shows it. Pure, no db — the names of
// accounts and cached transactions are passed in.
import type { Href } from 'expo-router';
import type { OutboxKind } from '../sync/outbox';
import { readPayload } from '../sync/payloadJson';

export interface QueuedChangeLookups {
  accountName: (id: string) => string | undefined;
  /** A cached transaction by its group id or (for a receipt upload) its journal id. */
  transaction: (ref: {
    groupId?: string;
    journalId?: string;
  }) => { groupId: string; description: string } | undefined;
}

export interface QueuedChangeInfo {
  /** The transaction, account or planned transaction it changes; null when that can't be told. */
  subject: string | null;
  /** Where tapping the card goes; null when there's nothing left to open (a deleted planned one). */
  route: Href | null;
  /**
   * Label keys (i18n) of what the change edits, for the card's "Changes:" line; empty for a create,
   * a delete, an upload, or when it can't be told. Two queued edits of one thing read apart by it.
   */
  changed: string[];
}

// FF3 transaction fields as a queued edit names them -> the label the detail screen shows them by.
const TRANSACTION_FIELD_LABELS: Record<string, string> = {
  amount: 'fields.amount',
  currency_code: 'fields.currency',
  date: 'fields.date',
  description: 'fields.description',
  category_name: 'fields.category',
  category_id: 'fields.category',
  budget_id: 'fields.budget',
  budget_name: 'fields.budget',
  source_id: 'fields.from',
  source_name: 'fields.from',
  destination_id: 'fields.to',
  destination_name: 'fields.to',
  notes: 'fields.note',
  tags: 'fields.tags',
};

// src/accounts/accountEdit.ts's AccountEdit -> the account page's labels.
const ACCOUNT_FIELD_LABELS: Record<string, string> = {
  name: 'accounts.name',
  currencyCode: 'fields.currency',
  includeNetWorth: 'account.includeNetWorth',
  virtualBalance: 'account.virtualBalance',
  openingBalance: 'account.openingBalance',
  openingBalanceDate: 'account.openingBalanceDate',
  accountRole: 'account.role',
  monthlyPaymentDate: 'account.monthlyPaymentDate',
};

// PlannedFields -> the planned editor's labels. `every` is part of the frequency.
const PLANNED_FIELD_LABELS: Record<string, string> = {
  name: 'planned.name',
  amount: 'fields.amount',
  currencyCode: 'fields.currency',
  date: 'planned.plannedOn',
  time: 'planned.time',
  repeats: 'planned.repeats',
  frequency: 'planned.frequencyLabel',
  every: 'planned.frequencyLabel',
  sourceId: 'fields.from',
  sourceName: 'fields.from',
  destinationId: 'fields.to',
  destinationName: 'fields.to',
  categoryName: 'fields.category',
  notes: 'fields.note',
  tags: 'fields.tags',
};

function labelsOf(keys: Iterable<string>, labels: Record<string, string>): string[] {
  return [...new Set([...keys].map((k) => labels[k]).filter((l): l is string => !!l))];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The ids of cached transactions the given operations point at, for the lookup query. */
export function referencedTransactions(ops: readonly { kind: OutboxKind; payloadJson: string }[]): {
  groupIds: string[];
  journalIds: string[];
} {
  const groupIds: string[] = [];
  const journalIds: string[] = [];
  for (const op of ops) {
    const p = safeRead(op.kind, op.payloadJson);
    if (!p) continue;
    if (typeof p.groupId === 'string') groupIds.push(p.groupId);
    if (op.kind === 'attach_receipt' && typeof p.transactionJournalId === 'string')
      journalIds.push(p.transactionJournalId);
  }
  return { groupIds, journalIds };
}

function safeRead(kind: OutboxKind, json: string): Record<string, unknown> | null {
  try {
    return readPayload(kind, json);
  } catch {
    return null;
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

export function describeQueuedChange(
  op: { kind: OutboxKind; payloadJson: string; inboxItemId: string | null },
  lookups: QueuedChangeLookups,
): QueuedChangeInfo {
  const p = safeRead(op.kind, op.payloadJson);
  if (!p) return { subject: null, route: null, changed: [] };
  switch (op.kind) {
    case 'create_transaction': {
      const splits = (p.splits as { description?: unknown }[] | undefined) ?? [];
      return {
        subject: str(p.groupTitle) ?? str(splits[0]?.description),
        route: op.inboxItemId ? `/draft/${op.inboxItemId}` : null,
        changed: [],
      };
    }
    case 'update_transaction':
    case 'delete_transaction':
    case 'recurring_review': {
      const groupId = p.groupId as string;
      const cached = lookups.transaction({ groupId });
      const changes = (p.changes as Record<string, unknown> | undefined) ?? {};
      const changed =
        op.kind === 'delete_transaction'
          ? []
          : [
              ...labelsOf(Object.keys(changes), TRANSACTION_FIELD_LABELS),
              ...(p.splits ? ['splits.split'] : []),
            ];
      return {
        subject: str(changes.description) ?? cached?.description ?? null,
        route: `/transactions/${groupId}`,
        changed,
      };
    }
    case 'attach_receipt': {
      const cached = lookups.transaction({ journalId: p.transactionJournalId as string });
      return {
        subject: cached?.description ?? null,
        route: cached ? `/transactions/${cached.groupId}` : null,
        changed: [],
      };
    }
    case 'update_account': {
      const id = p.accountId as string;
      const edit = (p.edit as Record<string, unknown> | undefined) ?? {};
      const changed = [
        ...labelsOf(Object.keys(edit), ACCOUNT_FIELD_LABELS),
        ...(p.active !== undefined ? ['accounts.active'] : []),
        ...(p.setEnvelopeMarker !== undefined ? ['accounts.cashEnvelope'] : []),
        ...(p.order !== undefined ? ['inbox.changedOrder'] : []),
      ];
      return {
        subject: str(edit.name) ?? lookups.accountName(id) ?? null,
        route: `/accounts/${id}`,
        changed,
      };
    }
    case 'save_planned': {
      const fields = p.fields as Record<string, unknown>;
      const before = p.before as Record<string, unknown> | null;
      // A new one has no "before": the kind line ("Saving a planned transaction") says it all.
      const changed = before
        ? labelsOf(
            Object.keys(fields).filter((k) => !same(fields[k], before[k])),
            PLANNED_FIELD_LABELS,
          )
        : [];
      return {
        subject: str(fields.name),
        route: `/planned/${encodeURIComponent(p.key as string)}`,
        changed,
      };
    }
    case 'delete_planned':
      return { subject: str(p.name), route: null, changed: [] };
  }
}
