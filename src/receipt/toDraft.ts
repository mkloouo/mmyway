import { and, eq } from 'drizzle-orm';
import { inboxItems } from '../db/schema';
import { getReceiptReader } from '../settings/appSettings';
import { transition } from '../inbox/state';
import { buildChain } from './buildChain';
import { runProviderChain } from './chain';
import { setReadingProvider, setWaitingForReader } from './readingProgress';
import type { OutboxDb } from '../sync/outbox';
import type { Draft, DraftLocation } from '../inbox/draft';
import { logLine } from '../utils/log';
import { readDraft, writeDraft } from '../inbox/draftJson';
import { resolvePayeeAlias } from '../lookup/aliases';
import { errorMessage } from '../utils/errorMessage';
import { generateId } from '../utils/id';
import { buildReceiptDraftReference, receiptToDrafts } from './receiptToDraft';

export {
  LOW_CONFIDENCE_THRESHOLD,
  type ReceiptDraftReference,
  buildReceiptDraftReference,
  lowConfidenceFields,
  receiptLocalDate,
  receiptDate,
  isZeroAmount,
  receiptToDrafts,
  receiptToDraft,
} from './receiptToDraft';

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

function capturedLocation(item: { draftJson: string }): DraftLocation | undefined {
  try {
    return readDraft(item.draftJson).location;
  } catch {
    return undefined;
  }
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

function setParsedDraft(db: OutboxDb, itemId: string, draft: Draft, expectedUpdatedAt: string) {
  return db
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
        eq(inboxItems.updatedAt, expectedUpdatedAt),
      ),
    )
    .returning({ id: inboxItems.id })
    .all();
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
    // Settings → Receipt reading "Nobody": the photo stays attached and the user types the details.
    // Not an error — the item is parsed with a blank draft, like a manual entry's start.
    if ((await getReceiptReader(db)) === 'none') {
      const blank: Draft = {
        type: 'withdrawal',
        amount: '',
        currencyCode: '',
        date: capturedDate(before).toISOString(),
        description: '',
        isNewPayee: true,
        location: capturedLocation(before),
      };
      const moved = setParsedDraft(db, itemId, blank, before.updatedAt);
      return moved.length > 0 ? 'parsed' : 'waiting';
    }
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

  logLine('info', `receipt ${itemId}: read by ${result.providerName} (${result.providerModel})`);
  const rawDrafts = receiptToDrafts(result.extraction, reference, capturedDate(before));
  const [firstRaw, ...extraRaws] = rawDrafts;
  if (!firstRaw) return 'waiting';

  const readByMeta = {
    provider: result.providerName,
    model: result.providerModel,
    at: new Date().toISOString(),
  };

  const rawDraft = {
    ...firstRaw,
    // receiptToDraft builds a fresh draft from what was read; where the photo was taken is the
    // stub's and has to survive it (#67).
    location: capturedLocation(before),
    readBy: readByMeta,
  };
  const draft = await resolvePayeeAlias(db, rawDraft);
  // Only if nothing touched the item while the provider was working (a parse takes seconds; the
  // user may already have opened the card and typed an amount) — their edits win.
  const extras = await Promise.all(
    extraRaws.map((extraRaw) =>
      resolvePayeeAlias(db, {
        ...extraRaw,
        location: capturedLocation(before),
        readBy: readByMeta,
      }),
    ),
  );
  // The main exchange and its fees are one parse result. A failed extra insert must not leave
  // a partially parsed receipt that will never retry its missing transactions.
  return db.transaction((tx) => {
    const updated = setParsedDraft(tx, itemId, draft, before.updatedAt);
    if (updated.length === 0) return 'waiting';
    for (const extraDraft of extras) {
      tx.insert(inboxItems)
        .values({
          id: generateId(),
          kind: 'receipt',
          state: 'parsed',
          draftJson: writeDraft(extraDraft),
          receiptImagePath: before.receiptImagePath,
          receiptContentHash: null,
          createdAt: before.createdAt,
          updatedAt: new Date().toISOString(),
        })
        .run();
    }
    return 'parsed';
  });
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
