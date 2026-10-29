// Exercise the real capture / reader -> SQLite draft -> confirmation -> FF3 request pipeline.
// Only external providers, HTTP and native file storage are replaced.
import { eq } from 'drizzle-orm';
import { createTestDb } from '../db/testDb';
import {
  cachedTransactions,
  inboxItems,
  outboxOperations,
  referenceAccounts,
  referenceCurrencies,
} from '../db/schema';
import { createManualEntry, confirmInboxItem } from '../inbox/createManualEntry';
import { buildManualEntryInput, type CaptureFormState } from '../capture/buildManualEntryInput';
import { updateDraft } from '../inbox/updateDraft';
import { readDraft, writeDraft } from '../inbox/draftJson';
import { draftAccountCurrency } from '../inbox/fx';
import { draftReadiness } from '../inbox/readiness';
import { parseReceiptItem } from '../receipt/toDraft';
import { buildChain } from '../receipt/buildChain';
import { createLocalProvider } from '../receipt/providers/local';
import { createGeminiProvider } from '../receipt/providers/gemini';
import { setDefaultSourceAccountId } from '../settings/appSettings';
import { replayOutbox, retryOperationNow, discardOperation } from './outbox';
import { createFF3Client } from '../api/ff3/client';
import type { TransactionSplit } from '../api/ff3/types';

jest.mock('../receipt/buildChain', () => ({ buildChain: jest.fn() }));
jest.mock('expo-file-system', () => ({
  File: jest
    .fn()
    .mockImplementation(() => ({ exists: true, arrayBuffer: async () => new ArrayBuffer(3) })),
}));
const T = '2026-10-28T12:00:00Z';
const accounts = [
  { id: 'pln', name: 'Wallet', currencyCode: 'PLN', type: 'asset' },
  { id: 'eur', name: 'Savings', currencyCode: 'EUR', type: 'asset' },
  { id: 'shop', name: 'Shop', currencyCode: 'PLN', type: 'expense' },
  { id: 'employer', name: 'Employer', currencyCode: 'PLN', type: 'revenue' },
];
const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  jest.clearAllMocks();
});

async function seededDb() {
  const db = createTestDb();
  await db
    .insert(referenceAccounts)
    .values(accounts.map((a) => ({ ...a, active: true, syncedAt: T })));
  await db.insert(referenceCurrencies).values(
    ['PLN', 'EUR'].map((code) => ({
      code,
      name: code,
      symbol: code,
      decimalPlaces: 2,
      enabled: true,
      isDefault: code === 'PLN',
      syncedAt: T,
    })),
  );
  await setDefaultSourceAccountId(db, 'pln');
  return db;
}

function capture(overrides: Partial<CaptureFormState> = {}): CaptureFormState {
  return {
    type: 'withdrawal',
    amount: '15.00',
    currencyCode: 'PLN',
    date: new Date(T),
    description: 'Purchase',
    merchantRawInput: 'Shop',
    forceNewPayee: false,
    sourceId: 'pln',
    destinationId: null,
    categoryName: null,
    budgetId: null,
    notes: 'Test entry',
    tags: ['review'],
    sharedWith: '',
    foreignAmount: '',
    foreignCurrencyCode: null,
    ...overrides,
  };
}

function ff3() {
  const posted: TransactionSplit[][] = [];
  const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
    if (url === 'https://ff3.example/api/v1/attachments') {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        attachable_type: 'TransactionJournal',
        attachable_id: 'journal-1',
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { id: 'attachment-1' } }),
      } as Response;
    }
    if (url === 'https://ff3.example/api/v1/attachments/attachment-1/upload') {
      expect(init?.body).toBeInstanceOf(ArrayBuffer);
      return { ok: true, status: 204 } as Response;
    }
    if (url !== 'https://ff3.example/api/v1/transactions' || init?.method !== 'POST') {
      throw new Error(`Unexpected request ${url}`);
    }
    const body = JSON.parse(String(init.body));
    expect(body.error_if_duplicate_hash).toBe(true);
    posted.push(body.transactions);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          id: 'group-1',
          type: 'transactions',
          attributes: {
            updated_at: T,
            transactions: body.transactions.map((split: TransactionSplit, i: number) => ({
              ...split,
              transaction_journal_id: `journal-${i + 1}`,
            })),
          },
        },
      }),
      headers: new Headers({ 'content-type': 'application/json' }),
    } as Response;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return {
    posted,
    fetchMock,
    client: createFF3Client({ baseUrl: 'https://ff3.example', apiToken: 'test-only' }),
  };
}

it.each([
  [
    'expense',
    capture(),
    {
      type: 'withdrawal',
      amount: '15.00',
      currency_code: 'PLN',
      source_id: 'pln',
      destination_id: 'shop',
    },
  ],
  [
    'income',
    capture({
      type: 'deposit',
      sourceId: null,
      destinationId: 'pln',
      merchantRawInput: 'Employer',
    }),
    { type: 'deposit', source_id: 'employer', destination_id: 'pln' },
  ],
  [
    'transfer',
    capture({
      type: 'transfer',
      destinationId: 'eur',
      foreignAmount: '3.50',
      foreignCurrencyCode: 'EUR',
    }),
    {
      type: 'transfer',
      source_id: 'pln',
      destination_id: 'eur',
      amount: '15.00',
      foreign_amount: '3.50',
      foreign_currency_code: 'EUR',
    },
  ],
  [
    'foreign expense',
    capture({ currencyCode: 'EUR', foreignAmount: '65.00', foreignCurrencyCode: 'PLN' }),
    {
      amount: '65.00',
      currency_code: 'PLN',
      foreign_amount: '15.00',
      foreign_currency_code: 'EUR',
    },
  ],
] as const)(
  'submits a manual %s with the intended accounts and decimal amounts',
  async (_label, form, expected) => {
    const db = await seededDb();
    const server = ff3();
    const { inboxItemId } = await createManualEntry(db, buildManualEntryInput(form, accounts));
    expect(await db.select().from(outboxOperations)).toHaveLength(0);
    expect(server.fetchMock).not.toHaveBeenCalled();
    await confirmInboxItem(db, inboxItemId);
    const result = await replayOutbox(db, server.client);
    expect(result.failedAt).toBeNull();
    expect(server.posted).toHaveLength(1);
    expect(server.posted[0]![0]).toMatchObject({
      ...expected,
      notes: 'Test entry',
      tags: ['review'],
      internal_reference: `mmyway:${inboxItemId}`,
    });
    expect((await db.select().from(inboxItems))[0]!.state).toBe('synced');
    expect(await db.select().from(cachedTransactions)).toHaveLength(1);
    expect(await db.select().from(outboxOperations)).toHaveLength(0);
  },
);

it.each(['local', 'Gemini'] as const)(
  'submits a %s receipt after review, preserving nullable extraction fields and FX correction',
  async (name) => {
    const db = await seededDb();
    await db.insert(inboxItems).values({
      id: 'receipt',
      kind: 'receipt',
      state: 'captured',
      draftJson: writeDraft({
        type: 'withdrawal',
        amount: '',
        currencyCode: '',
        date: T,
        description: '',
        isNewPayee: true,
      }),
      receiptImagePath: 'file:///receipts/photo.jpg',
      createdAt: T,
      updatedAt: T,
    });
    const provider =
      name === 'local'
        ? createLocalProvider({ baseUrl: 'https://model.example', model: 'test' })
        : createGeminiProvider({ apiKey: 'test-only' });
    (buildChain as jest.Mock).mockResolvedValue([provider]);
    const text = JSON.stringify({
      amount: 15,
      currency: 'EUR',
      merchant: 'Shop',
      date: '2026-10-28',
      confidence: 'high',
      payment_method: 'card',
      items: null,
      currency_exchanges: null,
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () =>
        name === 'local'
          ? { choices: [{ message: { content: text } }] }
          : { candidates: [{ content: { parts: [{ text }] } }] },
    });
    expect(await parseReceiptItem(db, 'receipt', 'aGk=')).toBe('parsed');
    const draft = readDraft((await db.select().from(inboxItems))[0]!.draftJson);
    expect(draft).toMatchObject({
      amount: '15',
      currencyCode: 'EUR',
      destinationName: 'Shop',
      sourceId: 'pln',
    });
    const accountCurrency = draftAccountCurrency(
      draft,
      (id) => accounts.find((a) => a.id === id)?.currencyCode,
    );
    expect(draftReadiness(draft, accountCurrency).missing).toContain('converted amount');
    expect(await db.select().from(outboxOperations)).toHaveLength(0);
    await updateDraft(db, 'receipt', {
      foreignAmount: '65.00',
      foreignCurrencyCode: 'PLN',
      notes: 'Reviewed',
    });
    await confirmInboxItem(db, 'receipt');
    const server = ff3();
    expect((await replayOutbox(db, server.client)).failedAt).toBeNull();
    expect(server.posted[0]![0]).toMatchObject({
      amount: '65.00',
      currency_code: 'PLN',
      foreign_amount: '15',
      foreign_currency_code: 'EUR',
      source_id: 'pln',
      destination_id: 'shop',
      notes: 'Reviewed',
    });
    expect(server.fetchMock).toHaveBeenCalledTimes(3);
    expect(await db.select().from(outboxOperations)).toHaveLength(0);
    expect((await db.select().from(inboxItems))[0]).toMatchObject({
      state: 'synced',
      receiptImagePath: 'file:///receipts/photo.jpg',
    });
  },
);

it('keeps an offline manual submission queued and sends it once connectivity returns', async () => {
  const db = await seededDb();
  const { inboxItemId } = await createManualEntry(db, buildManualEntryInput(capture(), accounts));
  const confirmed = await confirmInboxItem(db, inboxItemId);
  const server = ff3();
  server.fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
  expect((await replayOutbox(db, server.client)).failedAt).toBe(confirmed.outboxOperationId);
  expect((await db.select().from(inboxItems))[0]!.state).toBe('confirmed');
  await retryOperationNow(db, confirmed.outboxOperationId);
  expect((await replayOutbox(db, server.client)).failedAt).toBeNull();
  expect(server.posted).toHaveLength(1);
  expect(await db.select().from(outboxOperations)).toHaveLength(0);
  expect((await db.select().from(inboxItems).where(eq(inboxItems.id, inboxItemId)))[0]!.state).toBe(
    'synced',
  );
});

it('keeps a rejected submission recoverable for correction and resubmission', async () => {
  const db = await seededDb();
  const { inboxItemId } = await createManualEntry(db, buildManualEntryInput(capture(), accounts));
  const { outboxOperationId } = await confirmInboxItem(db, inboxItemId);
  const server = ff3();
  server.fetchMock.mockResolvedValueOnce({
    ok: false,
    status: 422,
    headers: new Headers(),
    text: async () =>
      JSON.stringify({
        message: 'Validation failed',
        errors: { 'transactions.0.amount': ['Invalid amount'] },
      }),
  } as Response);
  expect((await replayOutbox(db, server.client)).failedAt).toBe(outboxOperationId);
  const [failed] = await db.select().from(outboxOperations);
  expect(failed!.lastError).toContain('Invalid amount');
  expect(failed!.status).toBe('failed');
  // Cancel verifies that nothing landed before making the draft editable again.
  server.fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ data: [] }),
  } as Response);
  expect(await discardOperation(db, outboxOperationId, async () => server.client)).toBe(
    'discarded',
  );
  await updateDraft(db, inboxItemId, { amount: '20.00' });
  await confirmInboxItem(db, inboxItemId);
  expect((await replayOutbox(db, server.client)).failedAt).toBeNull();
  expect(server.posted).toHaveLength(1);
  expect(server.posted[0]![0]!.amount).toBe('20.00');
});
