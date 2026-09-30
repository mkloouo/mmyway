import { and, eq } from 'drizzle-orm';
import { referenceCategories, referenceCurrencies, inboxItems } from '../db/schema';
import { getDefaultSourceAccountId, getCashAccountId } from '../settings/appSettings';
import { transition } from '../inbox/state';
import { buildChain } from './buildChain';
import { runProviderChain } from './chain';
import { setReadingProvider, setWaitingForReader } from './readingProgress';
import type { OutboxDb } from '../sync/outbox';
import type { Draft } from '../inbox/draft';
import type { ReceiptExtraction } from './types';
import { logLine } from '../utils/log';
import { resolvePayeeAlias } from '../lookup/aliases';
import { readDraft, writeDraft } from '../inbox/draftJson';
import { errorMessage } from '../utils/errorMessage';

// Below this confidence, guessing a field the model wasn't sure about does more harm than
// leaving it blank for the user to fill in on the draft screen.
const LOW_CONFIDENCE_THRESHOLD = 0.4;

export interface ReceiptDraftReference {
  categoryNames: string[];
  currencyCodes: string[];
  cashAccountId?: string;
  cardAccountId?: string;
}

export async function buildReceiptDraftReference(db: OutboxDb): Promise<ReceiptDraftReference> {
  const [categories, currencies, defaultAccountId, cashAccountId] = await Promise.all([
    db.select().from(referenceCategories),
    db.select().from(referenceCurrencies),
    getDefaultSourceAccountId(db),
    getCashAccountId(db),
  ]);
  return {
    categoryNames: categories.map((c) => c.name),
    currencyCodes: currencies.map((c) => c.code),
    // Falls back to leaving the source blank — never a guess — when nothing is configured
    // (design §6.6's DEFAULTS row: "Cash payments use ␣").
    cashAccountId: cashAccountId ?? undefined,
    cardAccountId: defaultAccountId ?? undefined,
  };
}

// Fields the provider still populated despite an overall confidence below threshold (design
// §6.3). Currency and category aren't listed here — an untrusted currency or an unrecognized
// category is already blanked outright, rather than shown-but-flagged.
function lowConfidenceFields(extraction: ReceiptExtraction): string[] | undefined {
  if (extraction.confidence >= LOW_CONFIDENCE_THRESHOLD) return undefined;
  const fields: string[] = [];
  if (extraction.amount) fields.push('amount');
  if (extraction.merchant) fields.push('payee');
  if (extraction.date) fields.push('date');
  return fields.length > 0 ? fields : undefined;
}

// A receipt's printed date and time are wall-clock time where it was printed — the device's zone,
// in practice. Building the ISO string by hand with a `Z` suffix treated 23:30 in Warsaw as 23:30
// UTC, which is 01:30 the next day there. No time: noon, so no zone offset can move the day.
export function receiptLocalDate(date: string, time: string | null): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time ? time.split(':').map(Number) : [12, 0];
  return new Date(y!, m! - 1, d!, hh!, mm!);
}

/**
 * When the receipt was paid: its printed date and time; else, for a printed date without a time,
 * the photo's time when it was taken that day (noon otherwise); else when the photo was taken.
 * `takenAt` is the photo's own time, or when it was captured — never the time it was read, which
 * can be hours later after an offline stretch.
 */
export function receiptDate(
  extraction: Pick<ReceiptExtraction, 'date' | 'time'>,
  takenAt: Date,
): Date {
  if (!extraction.date) return takenAt;
  const printed = receiptLocalDate(extraction.date, extraction.time);
  if (extraction.time) return printed;
  const sameDay =
    printed.getFullYear() === takenAt.getFullYear() &&
    printed.getMonth() === takenAt.getMonth() &&
    printed.getDate() === takenAt.getDate();
  return sameDay ? takenAt : printed;
}

// Maps a receipt extraction onto a draft. Never throws on a field it doesn't recognize —
// normalizeExtraction (src/receipt/providers/local.ts) already dropped anything unexpected;
// this only has to cope with values it can't trust (unsynced currency, low confidence).
export function receiptToDraft(
  extraction: ReceiptExtraction,
  reference: ReceiptDraftReference,
  takenAt: Date,
): Draft {
  const category =
    extraction.category && reference.categoryNames.includes(extraction.category)
      ? extraction.category
      : undefined;
  const currencyTrusted =
    !!extraction.currency &&
    reference.currencyCodes.includes(extraction.currency) &&
    extraction.confidence >= LOW_CONFIDENCE_THRESHOLD;
  const sourceId =
    extraction.paymentMethod === 'cash'
      ? reference.cashAccountId
      : extraction.paymentMethod === 'card'
        ? reference.cardAccountId
        : undefined;
  const notes =
    extraction.items.length > 0
      ? extraction.items.map((item) => `${item.count}x ${item.title} (${item.price})`).join('\n')
      : undefined;
  const date = receiptDate(extraction, takenAt).toISOString();

  return {
    type: 'withdrawal',
    amount: extraction.amount ?? '',
    currencyCode: currencyTrusted ? extraction.currency! : '',
    date,
    description: extraction.merchant ?? 'Receipt',
    destinationName: extraction.merchant ?? undefined,
    isNewPayee: true, // a payee alias (parseReceiptItem) or the draft screen's payee picker corrects this
    categoryName: category,
    sourceId,
    notes,
    lowConfidenceFields: lowConfidenceFields(extraction),
  };
}

export type ParseOutcome = 'parsed' | 'waiting' | 'failed';

/** The stub's date: when the photo was taken, else when it was captured (src/receipt/ingest.ts). */
function capturedDate(item: { draftJson: string; createdAt: string }): Date {
  try {
    const date = new Date(readDraft(item.draftJson).date);
    if (!Number.isNaN(date.getTime())) return date;
  } catch {
    // An unreadable stub still has the time it was captured.
  }
  return new Date(item.createdAt);
}

function markReceiptError(db: OutboxDb, itemId: string, message: string): Promise<unknown> {
  return db
    .update(inboxItems)
    .set({
      state: transition('captured', 'fail'),
      errorMessage: message,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(inboxItems.id, itemId), eq(inboxItems.state, 'captured')));
}

// Shared by the immediate-parse path (app/receipt.tsx, already holding the base64 from the
// picker) and the retry path (runSync, re-reading the kept file — see readReceiptImageBase64).
//
// - parsed: captured -> parsed, draft filled in.
// - waiting: no provider answered (offline, PC asleep) — left `captured`, runSync retries it.
// - failed: nothing configured, or a provider answered with nothing usable — the item goes to
//   `error` with the reason, so the Inbox shows it under Needs attention (Retry / Discard)
//   instead of "Reading receipt…" forever. That stuck card was a bot bug the brief (§3.4)
//   explicitly listed as one not to carry over.
export async function parseReceiptItem(
  db: OutboxDb,
  itemId: string,
  imageBase64: string,
  hint?: string,
): Promise<ParseOutcome> {
  const [before] = await db.select().from(inboxItems).where(eq(inboxItems.id, itemId));
  if (!before || before.state !== 'captured') return 'waiting';

  const providers = await buildChain(db);
  if (providers.length === 0) {
    await markReceiptError(
      db,
      itemId,
      'No receipt reader is set up — add a local model or a Gemini key in Settings, then Retry.',
    );
    return 'failed';
  }

  const reference = await buildReceiptDraftReference(db);
  const result = await runProviderChain(
    providers,
    {
      imageBase64,
      hint,
      categoryNames: reference.categoryNames,
      currencyCodes: reference.currencyCodes,
    },
    (name) => setReadingProvider(itemId, name),
  ).finally(() => setReadingProvider(itemId, null));
  if (!result.ok) {
    logLine('warn', `receipt ${itemId}: ${result.reason} — ${result.errors.join('; ')}`);
    if (result.reason === 'all_providers_unreachable') {
      setWaitingForReader(itemId, true);
      return 'waiting';
    }
    await markReceiptError(db, itemId, `Could not read this receipt (${result.errors.join('; ')})`);
    return 'failed';
  }

  if (result.extraction.notAReceipt) {
    await markReceiptError(
      db,
      itemId,
      `${result.providerName} says this picture isn't a receipt. Retry, or discard it.`,
    );
    return 'failed';
  }

  // A merchant read before and corrected since books to the corrected payee (src/lookup/aliases.ts).
  const draft = await resolvePayeeAlias(
    db,
    receiptToDraft(result.extraction, reference, capturedDate(before)),
  );
  // Only if nothing touched the item while the provider was working (a parse takes seconds; the
  // user may already have opened the card and typed an amount) — their edits win.
  const updated = await db
    .update(inboxItems)
    .set({
      draftJson: writeDraft(draft),
      state: transition('captured', 'parsed'),
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(inboxItems.id, itemId),
        eq(inboxItems.state, 'captured'),
        eq(inboxItems.updatedAt, before.updatedAt),
      ),
    )
    .returning({ id: inboxItems.id });
  return updated.length > 0 ? 'parsed' : 'waiting';
}

// Lazy require, not a module-scope import — same reasoning as outbox.ts's attach_receipt
// branch: this file is imported by toDraft.test.ts and must stay Jest-safe. Exported for
// src/receipt/useSharedImages.ts, which needs the same base64 read for a shared image's path.
export async function readReceiptImageBase64(path: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readAsStringAsync, EncodingType } = require('expo-file-system/legacy');
  return readAsStringAsync(path, { encoding: EncodingType.Base64 });
}

// One receipt's trouble never ends the loop — a missing image used to throw out of here and turn
// every later sync into "Sync error".
export async function retryPendingReceipts(
  db: OutboxDb,
  read: (path: string) => Promise<string> = readReceiptImageBase64,
): Promise<number> {
  const pending = await db
    .select()
    .from(inboxItems)
    .where(and(eq(inboxItems.kind, 'receipt'), eq(inboxItems.state, 'captured')));
  let parsed = 0;
  for (const row of pending) {
    if (!row.receiptImagePath) continue;
    let imageBase64: string;
    try {
      imageBase64 = await read(row.receiptImagePath);
    } catch (err) {
      logLine(
        'error',
        `receipt ${row.id}: image unreadable at ${row.receiptImagePath}: ${errorMessage(err)}`,
      );
      await markReceiptError(
        db,
        row.id,
        'The receipt photo is no longer on this device. Discard this item and capture it again.',
      );
      continue;
    }
    try {
      if ((await parseReceiptItem(db, row.id, imageBase64)) === 'parsed') parsed += 1;
    } catch (err) {
      logLine('error', `receipt ${row.id}: parse failed: ${errorMessage(err)}`);
    }
  }
  return parsed;
}
