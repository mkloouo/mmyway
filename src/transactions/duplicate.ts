// Duplicate on the transaction screen: a new Inbox draft with exactly the same data — date, every
// split, tags and all — for the user to change and confirm like any other entry (confirm stays
// mandatory: nothing is sent from here).
import { inboxItems, type cachedTransactions } from '../db/schema';
import type { Draft, DraftSplit } from '../inbox/draft';
import { writeDraft } from '../inbox/draftJson';
import type { OutboxDb } from '../sync/outbox';
import { generateId } from '../utils/id';
import { readSplits, type CachedSplit } from './splitsJson';

type CachedRow = typeof cachedTransactions.$inferSelect;

const SHARED_TAG_PREFIX = 'mmyway-shared-';

function tagsOf(tags: string[]): { sharedWith?: string; extraTags?: string[] } {
  const shared = tags.find((t) => t.startsWith(SHARED_TAG_PREFIX));
  const rest = tags.filter((t) => t !== shared);
  return {
    ...(shared ? { sharedWith: shared.slice(SHARED_TAG_PREFIX.length) } : {}),
    ...(rest.length ? { extraTags: rest } : {}),
  };
}

function parseTags(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

const opt = (value: string | null | undefined): string | undefined => value ?? undefined;

/** The row's splits: the cached ones, or the row itself for one cached before splits were kept. */
function splitsOf(row: CachedRow): CachedSplit[] {
  return readSplits(row.splitsJson) ?? [{
    journalId: row.journalId, amount: row.amount, description: row.description,
    sourceId: row.sourceId, sourceName: row.sourceName, destinationId: row.destinationId, destinationName: row.destinationName,
    categoryName: row.categoryName, budgetId: row.budgetId, budgetName: row.budgetName, notes: row.notes,
    tags: parseTags(row.tagsJson), foreignAmount: row.foreignAmount, foreignCurrencyCode: row.foreignCurrencyCode,
  }];
}

export function draftFromTransaction(row: CachedRow): Draft {
  const type = row.type as Draft['type'];
  const [first, ...rest] = splitsOf(row);
  const draft: Draft = {
    type,
    amount: first!.amount,
    currencyCode: row.currencyCode,
    foreignAmount: opt(first!.foreignAmount),
    foreignCurrencyCode: opt(first!.foreignCurrencyCode),
    date: row.date,
    description: first!.description,
    sourceId: opt(first!.sourceId),
    sourceName: opt(first!.sourceName),
    destinationId: opt(first!.destinationId),
    destinationName: opt(first!.destinationName),
    // The payee exists in FF3 already: it books to the same account by id.
    isNewPayee: false,
    categoryName: opt(first!.categoryName),
    budgetId: opt(first!.budgetId),
    notes: opt(first!.notes),
    ...tagsOf(first!.tags),
  };
  if (rest.length === 0) return draft;
  const extraSplits: DraftSplit[] = rest.map((s) => ({
    amount: s.amount,
    description: s.description,
    payeeName: opt(type === 'deposit' ? s.sourceName : s.destinationName),
    payeeId: opt(type === 'deposit' ? s.sourceId : s.destinationId),
    isNewPayee: false,
    categoryName: opt(s.categoryName),
    budgetId: opt(s.budgetId),
    notes: opt(s.notes),
    ...tagsOf(s.tags),
  }));
  return { ...draft, extraSplits, total: row.amount, groupTitle: row.description };
}

/** Puts the copy in the Inbox as a draft and returns its id, for the draft screen to open. */
export async function duplicateTransaction(db: OutboxDb, row: CachedRow): Promise<string> {
  const id = generateId();
  const now = new Date().toISOString();
  await db.insert(inboxItems).values({
    id, kind: 'manual_entry', state: 'captured', draftJson: writeDraft(draftFromTransaction(row)),
    createdAt: now, updatedAt: now,
  });
  return id;
}
