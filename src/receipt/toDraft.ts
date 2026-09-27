import { eq } from 'drizzle-orm';
import { referenceAccounts, referenceCategories, referenceCurrencies, inboxItems } from '../db/schema';
import { getDefaultSourceAccountId } from '../settings/appSettings';
import { transition } from '../inbox/state';
import { buildChain } from './buildChain';
import { runProviderChain } from './chain';
import type { OutboxDb } from '../sync/outbox';
import type { Draft } from '../inbox/draft';
import type { ReceiptExtraction } from './types';

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
  const [categories, currencies, accounts, defaultAccountId] = await Promise.all([
    db.select().from(referenceCategories),
    db.select().from(referenceCurrencies),
    db.select().from(referenceAccounts),
    getDefaultSourceAccountId(db),
  ]);
  const assetAccounts = accounts.filter((a) => a.type === 'asset');
  return {
    categoryNames: categories.map((c) => c.name),
    currencyCodes: currencies.map((c) => c.code),
    // ponytail: no dedicated "is this the cash account" flag exists yet — name match plus the
    // user's configured default account. Add a dedicated per-account role setting if this
    // heuristic picks the wrong account often enough to matter.
    cashAccountId: assetAccounts.find((a) => /cash/i.test(a.name))?.id,
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

// Maps a receipt extraction onto a draft. Never throws on a field it doesn't recognize —
// normalizeExtraction (src/receipt/providers/local.ts) already dropped anything unexpected;
// this only has to cope with values it can't trust (unsynced currency, low confidence).
export function receiptToDraft(extraction: ReceiptExtraction, reference: ReceiptDraftReference): Draft {
  const category = extraction.category && reference.categoryNames.includes(extraction.category)
    ? extraction.category
    : undefined;
  const currencyTrusted = !!extraction.currency
    && reference.currencyCodes.includes(extraction.currency)
    && extraction.confidence >= LOW_CONFIDENCE_THRESHOLD;
  const sourceId = extraction.paymentMethod === 'cash' ? reference.cashAccountId
    : extraction.paymentMethod === 'card' ? reference.cardAccountId
    : undefined;
  const notes = extraction.items.length > 0
    ? extraction.items.map((item) => `${item.count}x ${item.title} (${item.price})`).join('\n')
    : undefined;
  const date = extraction.date ? `${extraction.date}T${extraction.time ?? '00:00'}:00.000Z` : new Date().toISOString();

  return {
    type: 'withdrawal',
    amount: extraction.amount ?? '',
    currencyCode: currencyTrusted ? extraction.currency! : '',
    date,
    description: extraction.merchant ?? 'Receipt',
    destinationName: extraction.merchant ?? undefined,
    isNewPayee: true, // the draft screen's suggestion chips and alias matching correct this
    categoryName: category,
    sourceId,
    notes,
    lowConfidenceFields: lowConfidenceFields(extraction),
  };
}

// Shared by the immediate-parse path (app/receipt.tsx, already holding the base64 from the
// picker) and the retry path (runSync, re-reading the kept file — see readReceiptImageBase64).
// Transitions captured -> parsed on success; leaves the item untouched on failure so runSync's
// next pass retries it (brief §5.4: keep the image until the upload succeeds).
export async function parseReceiptItem(db: OutboxDb, itemId: string, imageBase64: string, hint?: string): Promise<boolean> {
  const providers = await buildChain(db);
  if (providers.length === 0) return false;

  const reference = await buildReceiptDraftReference(db);
  const result = await runProviderChain(providers, { imageBase64, hint, categoryNames: reference.categoryNames });
  if (!result.ok) return false;

  const rows = await db.select().from(inboxItems).where(eq(inboxItems.id, itemId));
  const item = rows[0];
  if (!item) return false;

  const draft = receiptToDraft(result.extraction, reference);
  await db.update(inboxItems)
    .set({ draftJson: JSON.stringify(draft), state: transition(item.state as any, 'parsed'), updatedAt: new Date().toISOString() })
    .where(eq(inboxItems.id, itemId));
  return true;
}

// Lazy require, not a module-scope import — same reasoning as outbox.ts's attach_receipt
// branch: this file is imported by toDraft.test.ts and must stay Jest-safe. Exported for
// src/receipt/useSharedImages.ts, which needs the same base64 read for a shared image's path.
export async function readReceiptImageBase64(path: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readAsStringAsync, EncodingType } = require('expo-file-system/legacy');
  return readAsStringAsync(path, { encoding: EncodingType.Base64 });
}

export async function retryPendingReceipts(db: OutboxDb): Promise<number> {
  const rows = await db.select().from(inboxItems);
  const pending = rows.filter((row) => row.kind === 'receipt' && row.state === 'captured' && row.receiptImagePath);
  let parsed = 0;
  for (const row of pending) {
    const imageBase64 = await readReceiptImageBase64(row.receiptImagePath!);
    if (await parseReceiptItem(db, row.id, imageBase64)) parsed += 1;
  }
  return parsed;
}
