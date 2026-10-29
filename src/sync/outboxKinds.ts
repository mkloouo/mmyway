import { eq } from 'drizzle-orm';
import type { Href } from 'expo-router';
import { replayCreateAccount } from '../accounts/accountCreate';
import { replayCreateBudget, replayDeleteBudget, replayUpdateBudget } from '../bucket/budgetReplay';
import { replaySetBudgetLimits, replaySetPiggyAmount } from '../bucket/replay';
import { outboxOperations } from '../db/schema';
import { plannedKey } from '../planned/objects';
import { replayDeletePlanned, replaySavePlanned, replayTriggerPlanned } from '../planned/replay';
import {
  replayCreateRule,
  replayToggleRule,
  replayToggleRuleGroup,
  replayTriggerRule,
} from '../rules/replay';
import {
  replayAttachReceipt,
  replayCreateTransaction,
  replayDeleteAttachment,
  replayUpdateTransaction,
} from './outboxTransactionReplay';
import { replayReorderAccounts, replayUpdateAccount } from './outboxAccountReplay';
import type { KindSpec, OutboxDb, OutboxKind, ReplayOutcome } from './outboxTypes';

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

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

const ACCOUNT_FIELD_LABELS: Record<string, string> = {
  name: 'accounts.name',
  currencyCode: 'fields.currency',
  includeNetWorth: 'account.fieldNetWorth',
  virtualBalance: 'account.virtualBalance',
  openingBalance: 'account.openingBalance',
  openingBalanceDate: 'account.openingBalanceDate',
  accountRole: 'account.role',
  monthlyPaymentDate: 'account.monthlyPaymentDate',
};

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

function addAccounts(splits: unknown, add: (prefix: string, value: unknown) => void): void {
  for (const s of (Array.isArray(splits) ? splits : []) as Record<string, unknown>[]) {
    add('account', s.source_id);
    add('account', s.destination_id);
  }
}

async function runReplayAndDelete(
  db: OutboxDb,
  rowId: string,
  action: () => Promise<unknown>,
): Promise<ReplayOutcome> {
  await action();
  await db.delete(outboxOperations).where(eq(outboxOperations.id, rowId));
  return 'done';
}

const describeAttachment: KindSpec['describe'] = (p, op, lookups) => {
  const cached = lookups.transaction({ journalId: p.transactionJournalId });
  return {
    subject: cached?.description ?? null,
    route: (cached ? `/transactions/${cached.groupId}` : null) as Href | null,
    changed: [],
  };
};

const TRANSACTION_UPDATE: KindSpec = {
  subjects: (p, add) => {
    add('group', p.groupId);
    add('journal', p.transactionJournalId);
    addAccounts([p.changes, ...(Array.isArray(p.splits) ? p.splits : [])], add);
  },
  describe: (p, op, lookups) => {
    const cached = lookups.transaction({ groupId: p.groupId });
    const changes = (p.changes as Record<string, unknown> | undefined) ?? {};
    return {
      subject: str(changes.description) ?? cached?.description ?? null,
      route: `/transactions/${p.groupId}` as Href,
      changed: [
        ...labelsOf(Object.keys(changes), TRANSACTION_FIELD_LABELS),
        ...(p.splits ? ['splits.split'] : []),
      ],
    };
  },
  replay: replayUpdateTransaction,
};

export const OUTBOX_KINDS = {
  create_transaction: {
    subjects: (p, add) => addAccounts(p.splits, add),
    describe: (p, op) => ({
      subject: str(p.groupTitle) ?? str(p.splits?.[0]?.description),
      route: (op.inboxItemId ? `/draft/${op.inboxItemId}` : null) as Href | null,
      changed: [],
    }),
    replay: replayCreateTransaction,
  },
  update_transaction: TRANSACTION_UPDATE,
  delete_transaction: {
    subjects: (p, add) => add('group', p.groupId),
    describe: (p, op, lookups) => ({
      subject: lookups.transaction({ groupId: p.groupId })?.description ?? null,
      route: `/transactions/${p.groupId}` as Href,
      changed: [],
    }),
    replay: replayUpdateTransaction,
  },
  attach_receipt: {
    subjects: (p, add) => add('journal', p.transactionJournalId),
    describe: describeAttachment,
    replay: replayAttachReceipt,
  },
  delete_attachment: {
    subjects: (p, add) => add('journal', p.transactionJournalId),
    describe: describeAttachment,
    replay: replayDeleteAttachment,
  },
  recurring_review: TRANSACTION_UPDATE,
  update_account: {
    subjects: (p, add) => add('account', p.accountId),
    describe: (p, op, lookups) => {
      const edit = (p.edit as Record<string, unknown> | undefined) ?? {};
      return {
        subject: str(edit.name) ?? lookups.accountName(p.accountId) ?? null,
        route: `/accounts/${p.accountId}` as Href,
        changed: [
          ...labelsOf(Object.keys(edit), ACCOUNT_FIELD_LABELS),
          ...(p.active !== undefined ? ['account.fieldActive'] : []),
          ...(p.setEnvelopeMarker !== undefined ? ['account.fieldCashCount'] : []),
          ...(p.order !== undefined ? ['inbox.changedOrder'] : []),
        ],
      };
    },
    replay: replayUpdateAccount,
  },
  reorder_accounts: {
    subjects: (p, add) => {
      for (const id of p.orderedIds) add('account', id);
    },
    describe: () => ({
      subject: null,
      route: '/settings/accounts' as Href,
      changed: ['inbox.changedOrder'],
    }),
    replay: replayReorderAccounts,
  },
  save_planned: {
    subjects: (p, add) => {
      add('planned', p.key);
      add('bill', p.billId);
      add('rule', p.ruleId);
      add('recurrence', p.recurrenceId);
    },
    describe: (p) => {
      const fields = (p.fields as Record<string, unknown> | undefined) ?? {};
      const before = p.before as Record<string, unknown> | null | undefined;
      const changed = before
        ? labelsOf(
            Object.keys(fields).filter((k) => !same(fields[k], before[k])),
            PLANNED_FIELD_LABELS,
          )
        : [];
      return {
        subject: str(fields.name),
        route: `/planned/${encodeURIComponent(String(p.key))}` as Href,
        changed,
      };
    },
    replay: ({ db, client }, p, row) =>
      runReplayAndDelete(db, row.id, () => replaySavePlanned(db, client, row.id, p)),
  },
  delete_planned: {
    subjects: (p, add) => {
      add('planned', p.key);
      add('bill', p.billId);
      add('rule', p.ruleId);
      add('recurrence', p.recurrenceId);
    },
    describe: (p) => ({ subject: str(p.name), route: null, changed: [] }),
    replay: ({ db, client }, p, row) =>
      runReplayAndDelete(db, row.id, () => replayDeletePlanned(db, client, p)),
  },
  trigger_planned: {
    subjects: (p, add) => {
      add('planned', p.key);
      add('bill', p.billId);
      add('rule', p.ruleId);
      add('recurrence', p.recurrenceId);
    },
    describe: (p) => ({
      subject: str(p.name),
      route: `/planned/${encodeURIComponent(String(p.key))}` as Href,
      changed: [],
    }),
    replay: ({ db, client }, p, row) =>
      runReplayAndDelete(db, row.id, () => replayTriggerPlanned(client, p)),
  },
  set_budget_limits: {
    subjects: (p, add) => {
      for (const entry of (p.entries ?? []) as { budgetId?: unknown }[]) {
        add('budget', entry.budgetId);
      }
    },
    describe: (p) => {
      const first = str((p.entries as { budgetId?: unknown }[] | undefined)?.[0]?.budgetId);
      return {
        subject: null,
        route: (first ? `/budget/${encodeURIComponent(first)}` : null) as Href | null,
        changed: [],
      };
    },
    replay: ({ db, client }, p, row) =>
      runReplayAndDelete(db, row.id, () => replaySetBudgetLimits(db, client, row.id, p)),
  },
  set_piggy_amount: {
    subjects: (p, add) => {
      add('piggy', p.piggyId);
      add('account', p.accountId);
    },
    describe: () => ({ subject: null, route: '/budget' as Href, changed: [] }),
    replay: ({ db, client }, p, row) =>
      runReplayAndDelete(db, row.id, () => replaySetPiggyAmount(db, client, p)),
  },
  create_budget: {
    subjects: (p, add) => add('budget', p.clientId),
    describe: (p) => ({ subject: str(p.name), route: '/budget' as Href, changed: [] }),
    replay: ({ db, client }, p, row) =>
      runReplayAndDelete(db, row.id, () => replayCreateBudget(db, client, row.id, p)),
  },
  update_budget: {
    subjects: (p, add) => add('budget', p.budgetId),
    describe: (p) => ({
      subject: str(p.name),
      route: `/budget/${encodeURIComponent(str(p.budgetId) ?? '')}` as Href,
      changed: [],
    }),
    replay: ({ db, client }, p, row) =>
      runReplayAndDelete(db, row.id, () => replayUpdateBudget(db, client, row.id, p)),
  },
  delete_budget: {
    subjects: (p, add) => add('budget', p.budgetId),
    describe: (p) => ({ subject: str(p.name), route: '/budget' as Href, changed: [] }),
    replay: ({ db, client }, p, row) =>
      runReplayAndDelete(db, row.id, () => replayDeleteBudget(db, client, row.id, p)),
  },
  create_account: {
    subjects: (p, add) => {
      add('account', p.clientId);
      add('account', p.serverId);
    },
    describe: (p) => ({
      subject: str((p.form as Record<string, unknown> | undefined)?.name),
      route: '/settings/accounts' as Href,
      changed: [],
    }),
    replay: ({ db, client }, p, row) =>
      runReplayAndDelete(db, row.id, () => replayCreateAccount(db, client, row.id, p)),
  },
  toggle_rule: {
    subjects: (p, add) => add('rule', p.ruleId),
    describe: (p) => ({
      subject: null,
      route: `/planned/object/${encodeURIComponent(plannedKey('rule', String(p.ruleId)))}` as Href,
      changed: ['account.fieldActive'],
    }),
    replay: ({ db, client }, p, row) =>
      runReplayAndDelete(db, row.id, () => replayToggleRule(db, client, p)),
  },
  toggle_rule_group: {
    subjects: (p, add) => add('rule_group', p.ruleGroupId),
    describe: () => ({ subject: null, route: null, changed: ['account.fieldActive'] }),
    replay: ({ db, client }, p, row) =>
      runReplayAndDelete(db, row.id, () => replayToggleRuleGroup(db, client, p)),
  },
  trigger_rule: {
    subjects: (p, add) => add('rule', p.ruleId),
    describe: (p) => ({
      subject: null,
      route: `/planned/object/${encodeURIComponent(plannedKey('rule', String(p.ruleId)))}` as Href,
      changed: [],
    }),
    replay: ({ db, client }, p, row) =>
      runReplayAndDelete(db, row.id, () => replayTriggerRule(client, p)),
  },
  create_rule: {
    subjects: (p, add) => {
      add('rule', p.clientId);
      add('rule', p.serverId);
    },
    describe: (p) => ({ subject: str(p.title), route: '/planned' as Href, changed: [] }),
    replay: ({ db, client }, p, row) =>
      runReplayAndDelete(db, row.id, () => replayCreateRule(db, client, row.id, p)),
  },
} as const satisfies Record<OutboxKind, KindSpec>;
