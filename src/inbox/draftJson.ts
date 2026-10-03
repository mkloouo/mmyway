// inbox_items.draft_json outlives app versions: a draft saved by one build is read by the next.
// Every write stamps a version (`v`), and every read validates the shape instead of casting, so a
// field renamed later fails loudly here rather than as `undefined` deep inside a screen.
import { z } from 'zod';
import type { Draft } from './draft';

const DRAFT_VERSION = 1;

const optionalText = z.string().optional();

const DraftSchema = z.looseObject({
  v: z.literal(DRAFT_VERSION).optional(), // absent on drafts written before versioning: read as v1
  type: z.enum(['withdrawal', 'deposit', 'transfer']),
  amount: z.string(),
  currencyCode: z.string(),
  foreignAmount: optionalText,
  foreignCurrencyCode: optionalText,
  date: z.string(),
  description: z.string(),
  sourceName: optionalText,
  sourceId: optionalText,
  destinationName: optionalText,
  destinationId: optionalText,
  isNewPayee: z.boolean(),
  payeeReadAs: optionalText,
  categoryName: optionalText,
  budgetId: optionalText,
  notes: optionalText,
  sharedWith: optionalText,
  extraTags: z.array(z.string()).optional(),
  lowConfidenceFields: z.array(z.string()).optional(),
  // Optional, so a draft written before it existed still reads as v1 — a version bump would
  // reject every draft already in the table.
  readBy: z.looseObject({ provider: z.string(), model: z.string(), at: z.string() }).optional(),
  location: z
    .looseObject({
      latitude: z.number(),
      longitude: z.number(),
      accuracyM: z.number().optional(),
    })
    .optional(),
  extraSplits: z
    .array(
      z.looseObject({
        amount: z.string(),
        description: z.string(),
        payeeName: optionalText,
        payeeId: optionalText,
        isNewPayee: z.boolean(),
        categoryName: optionalText,
        budgetId: optionalText,
        notes: optionalText,
        sharedWith: optionalText,
        extraTags: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  total: optionalText,
  groupTitle: optionalText,
});

/** A recurring review stores FF3's own journal; only the fields the app relies on are checked. */
const ReviewJournalSchema = z.looseObject({
  v: z.literal(DRAFT_VERSION).optional(),
  transaction_journal_id: z.string(),
  updated_at: z.string().optional(),
  tags: z.array(z.string()).optional(),
  amount: z.string().optional(),
  currency_code: z.string().optional(),
  description: z.string().optional(),
  date: z.string().optional(),
  type: z.string().optional(),
  source_id: z.string().nullish(),
  source_name: z.string().nullish(),
  destination_id: z.string().nullish(),
  destination_name: z.string().nullish(),
  foreign_amount: z.string().nullish(),
  foreign_currency_code: z.string().nullish(),
});

/** A recurrence books expenses, incomes and transfers alike; anything unrecognised reads as an expense. */
export function reviewType(journal: ReviewJournal): 'withdrawal' | 'deposit' | 'transfer' {
  return journal.type === 'deposit' || journal.type === 'transfer' ? journal.type : 'withdrawal';
}

/**
 * The amount a recurring transaction was planned in when that isn't the currency FF3 booked it
 * in (7.99 USD booked from a PLN account): the review then asks what was actually charged.
 */
export function reviewForeign(
  journal: ReviewJournal,
): { amount: string; currencyCode: string } | null {
  const { foreign_amount: amount, foreign_currency_code: currencyCode } = journal;
  return amount && currencyCode && currencyCode !== journal.currency_code
    ? { amount, currencyCode }
    : null;
}

export type ReviewJournal = z.infer<typeof ReviewJournalSchema>;

function describe(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue ? `${issue.path.join('.') || '(root)'}: ${issue.message}` : error.message;
}

export function readDraft(json: string): Draft {
  const result = DraftSchema.safeParse(JSON.parse(json));
  if (!result.success) throw new Error(`unreadable draft (${describe(result.error)})`);
  const { v: _v, ...draft } = result.data;
  return draft as Draft;
}

export function readReviewJournal(json: string): ReviewJournal {
  const result = ReviewJournalSchema.safeParse(JSON.parse(json));
  if (!result.success) throw new Error(`unreadable recurring review (${describe(result.error)})`);
  return result.data;
}

/** What goes into draft_json: the draft (or review journal) with the current version stamped on it. */
export function writeDraft(draft: Draft | Record<string, unknown>): string {
  return JSON.stringify({ ...draft, v: DRAFT_VERSION });
}
