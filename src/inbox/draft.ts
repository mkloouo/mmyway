import { eq, and, ne } from 'drizzle-orm';
import type { CreateTransactionPayload, OutboxDb } from '../sync/outbox';
import type { TransactionSplit } from '../api/ff3/types';
import { inboxItems } from '../db/schema';

export interface Draft {
  type: 'withdrawal' | 'deposit' | 'transfer';
  amount: string;
  currencyCode: string;
  foreignAmount?: string;
  foreignCurrencyCode?: string;
  date: string; // ISO 8601
  description: string;
  sourceName?: string;
  sourceId?: string;
  destinationName?: string;
  destinationId?: string;
  isNewPayee: boolean; // surfaced explicitly, never silently created (Global Constraints)
  // The payee text a payee alias replaced (src/lookup/aliases.ts), e.g. a receipt's printed
  // "ZABKA POLSKA SP Z O O" now booked as "Żabka". Shown on the draft screen; never sent to FF3.
  payeeReadAs?: string;
  categoryName?: string;
  budgetId?: string;
  notes?: string;
  sharedWith?: string; // -> `mmyway-shared-<person>` tag, brief §9 Q12
  extraTags?: string[]; // e.g. `mmyway-reconcile` (Task 9's cash count) — merged in ahead of sharedWith's tag
  // Field names the receipt provider couldn't confidently extract but still populated (design
  // §6.3): the draft screen marks these rows amber with "check this" instead of trusting them
  // silently. Never set outside src/receipt/toDraft.ts.
  lowConfidenceFields?: string[];
  // A split entry (the Split button, a duplicated split transaction). Split 1 is the draft's own
  // fields above; these are splits 2..N, sharing its type, date, currency and own account.
  // `total` is the total the user tracks (the splits must add up to it before Confirm) and
  // `groupTitle` FF3's title for the whole group. All three are absent on a plain entry.
  extraSplits?: DraftSplit[];
  total?: string;
  groupTitle?: string;
}

export interface DraftSplit {
  amount: string;
  description: string;
  payeeName?: string; // the destination of a withdrawal, the source of a deposit; unused for a transfer
  payeeId?: string;
  isNewPayee: boolean;
  categoryName?: string;
  budgetId?: string;
  notes?: string;
  sharedWith?: string;
  extraTags?: string[];
}

/**
 * The draft with every FF3 id taken out and the names kept. Ids belong to one instance; a draft
 * carried to another one re-resolves its names there, and readiness asks for what is missing.
 */
export function withoutInstanceIds(draft: Draft): Draft {
  const { sourceId: _s, destinationId: _d, budgetId: _b, extraSplits, ...rest } = draft;
  const out: Draft = { ...rest };
  if (extraSplits) {
    out.extraSplits = extraSplits.map(({ payeeId: _p, budgetId: _sb, ...split }) => split);
  }
  return out;
}

// Which end of the split is the free-text payee differs by type (defect (1)): a withdrawal's
// payee is the destination, a deposit's payee is the source, and a transfer has no payee at
// all — both ends are known asset accounts, so isNewPayee never gates them. A known payee with
// no id (picked from history, or an alias stored by name) is queued by name: sending neither left
// the transaction with no payee at all. The name becomes an id when it's sent (src/sync/accountIds.ts).
function payeeGatedEnd(draft: Draft): {
  source: { id?: string; name?: string };
  destination: { id?: string; name?: string };
} {
  if (draft.type === 'withdrawal') {
    return {
      source: { id: draft.sourceId, name: draft.sourceId ? undefined : draft.sourceName },
      destination:
        draft.isNewPayee || !draft.destinationId
          ? { id: undefined, name: draft.destinationName }
          : { id: draft.destinationId, name: undefined },
    };
  }
  if (draft.type === 'deposit') {
    return {
      source:
        draft.isNewPayee || !draft.sourceId
          ? { id: undefined, name: draft.sourceName }
          : { id: draft.sourceId, name: undefined },
      destination: {
        id: draft.destinationId,
        name: draft.destinationId ? undefined : draft.destinationName,
      },
    };
  }
  // transfer: both ends are asset account ids, never a free-text name.
  return {
    source: { id: draft.sourceId, name: undefined },
    destination: { id: draft.destinationId, name: undefined },
  };
}

export function draftToTransactionPayload(
  clientId: string,
  draft: Draft,
): CreateTransactionPayload {
  const extras = draft.extraSplits ?? [];
  if (extras.length === 0) return { clientId, splits: [draftSplitPayload(draft)] };
  return {
    clientId,
    groupTitle: draft.groupTitle || draft.description,
    splits: [
      draftSplitPayload(draft),
      ...extras.map((s) => draftSplitPayload(extraSplitAsDraft(draft, s))),
    ],
  };
}

/** Split 2..N as a whole draft: the group's shared fields from split 1, the rest its own. */
function extraSplitAsDraft(draft: Draft, split: DraftSplit): Draft {
  const payee =
    draft.type === 'withdrawal'
      ? { destinationName: split.payeeName, destinationId: split.payeeId }
      : draft.type === 'deposit'
        ? { sourceName: split.payeeName, sourceId: split.payeeId }
        : {};
  return {
    type: draft.type,
    date: draft.date,
    currencyCode: draft.currencyCode,
    sourceId: draft.sourceId,
    sourceName: draft.sourceName,
    destinationId: draft.destinationId,
    destinationName: draft.destinationName,
    ...payee,
    amount: split.amount,
    description: split.description,
    isNewPayee: split.isNewPayee,
    categoryName: split.categoryName,
    budgetId: split.budgetId,
    notes: split.notes,
    sharedWith: split.sharedWith,
    extraTags: split.extraTags,
  };
}

function draftSplitPayload(draft: Draft): TransactionSplit {
  const tags: string[] = [...(draft.extraTags ?? [])];
  if (draft.sharedWith) tags.push(`mmyway-shared-${draft.sharedWith}`);
  const { source, destination } = payeeGatedEnd(draft);

  return {
    type: draft.type,
    date: draft.date,
    amount: draft.amount,
    currency_code: draft.currencyCode,
    foreign_amount: draft.foreignAmount,
    foreign_currency_code: draft.foreignCurrencyCode,
    description: draft.description,
    source_id: source.id,
    source_name: source.name,
    destination_id: destination.id,
    destination_name: destination.name,
    category_name: draft.categoryName,
    budget_id: draft.budgetId,
    tags: tags.length ? tags : undefined,
    notes: draft.notes,
  };
}

export async function findDuplicateReceiptItem(
  db: OutboxDb,
  contentHash: string,
): Promise<{ id: string } | null> {
  const rows = await db
    .select()
    .from(inboxItems)
    .where(and(eq(inboxItems.receiptContentHash, contentHash), ne(inboxItems.state, 'error')));
  return rows[0] ? { id: rows[0].id } : null;
}
