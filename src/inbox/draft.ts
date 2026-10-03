import { eq, and, ne } from 'drizzle-orm';
import type { CreateTransactionPayload, OutboxDb } from '../sync/outbox';
import type { TransactionSplit } from '../api/ff3/types';
import { sanitizeSplit } from '../api/ff3/sanitize';
import { inboxItems } from '../db/schema';
import { sharedTags } from '../transactions/sharedWith';
import { fromMinor, proportionalShares, toMinor } from '../splits/allocate';
import { orientForBooking } from './fx';

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
  sharedWith?: string; // names, comma-separated -> one `mmyway-shared-<person>` tag each, brief §9 Q12
  extraTags?: string[]; // e.g. `mmyway-reconcile` (Task 9's cash count) — merged in ahead of sharedWith's tag
  // Field names the receipt provider couldn't confidently extract but still populated (design
  // §6.3): the draft screen marks these rows amber with "check this" instead of trusting them
  // silently. Never set outside src/receipt/toDraft.ts.
  lowConfidenceFields?: string[];
  // Which reader read this receipt, and with which model (#68): shown on the draft so a bad
  // reading can be traced back to the model that made it. A retry overwrites it, so it always
  // names the reading the draft holds. Never set outside src/receipt/toDraft.ts.
  readBy?: { provider: string; model: string; at: string };
  // Where the entry was made (#67, src/capture/position.ts): the phone's position while Capture or
  // the camera was open. Carried onto the transaction's splits as FF3's own latitude/longitude.
  location?: DraftLocation;
  // A split entry (the Split button, a duplicated split transaction). Split 1 is the draft's own
  // fields above; these are splits 2..N, sharing its type, date, currency and own account.
  // `total` is the total the user tracks (the splits must add up to it before Confirm) and
  // `groupTitle` FF3's title for the whole group. All three are absent on a plain entry.
  extraSplits?: DraftSplit[];
  total?: string;
  groupTitle?: string;
}

/** Where an entry was made: filled by src/capture/position.ts, sent as FF3's own location fields. */
export interface DraftLocation {
  latitude: number;
  longitude: number;
  /** How far off the fix may be, in metres, as the phone reported it. Kept here, not sent. */
  accuracyM?: number;
}

/** Street level on FF3's own map; it insists on a zoom_level whenever a latitude is sent. */
const FF3_ZOOM_LEVEL = 16;

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

/**
 * `bookingCurrencyCode` is the currency of the asset leg FF3 books in (src/inbox/fx.ts): the
 * entry's two figures are put the right way round against it. Left out, they go as they are —
 * which is only right for a draft with no foreign side.
 */
export function draftToTransactionPayload(
  clientId: string,
  draft: Draft,
  bookingCurrencyCode?: string,
): CreateTransactionPayload {
  const split = (d: Draft) => draftSplitPayload(d, bookingCurrencyCode);
  const extras = draft.extraSplits ?? [];
  if (extras.length === 0) return { clientId, splits: [split(draft)] };
  const converted = convertedShares(draft);
  return {
    clientId,
    groupTitle: draft.groupTitle || draft.description,
    splits: [
      split(converted ? { ...draft, foreignAmount: converted[0] } : draft),
      ...extras.map((s, i) => split(extraSplitAsDraft(draft, s, converted?.[i + 1]))),
    ],
  };
}

/** Plenty for comparing amounts of any currency; the shares go out at the entered scale. */
const WEIGHT_SCALE = 12;

/**
 * FF3's `foreign_amount` is per split, so a split entry in a currency the account doesn't hold
 * can't send one converted figure for the group (#129, after #105): the draft carries the
 * converted *total*, and it is spread over the splits in the same proportion as the splits
 * themselves. The shares are allocated in the minor units the total was typed in, so they add
 * back up to it exactly. Null when there is nothing to spread.
 */
function convertedShares(draft: Draft): string[] | null {
  const extras = draft.extraSplits ?? [];
  if (!draft.foreignAmount || !draft.foreignCurrencyCode) return null;
  const weights = [draft.amount, ...extras.map((s) => s.amount)].map((a) =>
    toMinor(a, WEIGHT_SCALE),
  );
  if (weights.every((w) => w <= 0n)) return null;
  const decimals = (draft.foreignAmount.split('.')[1] ?? '').length;
  return proportionalShares(toMinor(draft.foreignAmount, decimals), weights).map((share) =>
    fromMinor(share, decimals),
  );
}

/** Split 2..N as a whole draft: the group's shared fields from split 1, the rest its own. */
function extraSplitAsDraft(draft: Draft, split: DraftSplit, foreignAmount?: string): Draft {
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
    foreignAmount,
    foreignCurrencyCode: foreignAmount ? draft.foreignCurrencyCode : undefined,
    description: split.description,
    isNewPayee: split.isNewPayee,
    categoryName: split.categoryName,
    budgetId: split.budgetId,
    notes: split.notes,
    sharedWith: split.sharedWith,
    extraTags: split.extraTags,
    location: draft.location,
  };
}

function draftSplitPayload(draft: Draft, bookingCurrencyCode?: string): TransactionSplit {
  const tags: string[] = [...(draft.extraTags ?? [])];
  tags.push(...sharedTags(draft.sharedWith));
  const { source, destination } = payeeGatedEnd(draft);
  const money = orientForBooking(draft, bookingCurrencyCode);

  return sanitizeSplit({
    type: draft.type,
    date: draft.date,
    amount: money.amount,
    currency_code: money.currencyCode,
    foreign_amount: money.foreignAmount,
    foreign_currency_code: money.foreignCurrencyCode,
    description: draft.description,
    source_id: source.id,
    source_name: source.name,
    destination_id: destination.id,
    destination_name: destination.name,
    category_name: draft.categoryName,
    budget_id: draft.budgetId,
    tags,
    notes: draft.notes,
    // Every split of a group was bought in the same place, so each carries the same pin (#67).
    ...(draft.location
      ? {
          latitude: draft.location.latitude,
          longitude: draft.location.longitude,
          zoom_level: FF3_ZOOM_LEVEL,
        }
      : {}),
  });
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
