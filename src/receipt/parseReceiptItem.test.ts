import { eq } from 'drizzle-orm';
import { createTestDb } from '../db/testDb';
import { inboxItems } from '../db/schema';
import { parseReceiptItem } from './toDraft';
import { buildChain } from './buildChain';
import type { ReceiptExtraction } from './types';
import { writeDraft } from '../inbox/draftJson';

jest.mock('./buildChain', () => ({ buildChain: jest.fn() }));
jest.mock('../utils/log', () => ({ logLine: jest.fn() }));

const T = '2026-09-27T10:00:00Z';

function readingAs(
  merchant: string,
  printed: { date: string | null; time: string | null } = {
    date: '2026-09-27',
    time: '10:00',
  },
) {
  const extraction: ReceiptExtraction = {
    amount: '12.50',
    currency: null,
    merchant,
    date: printed.date,
    time: printed.time,
    category: null,
    items: [],
    confidence: 0.9,
    paymentMethod: 'unknown',
    cardNetwork: null,
  };
  (buildChain as jest.Mock).mockResolvedValue([{ name: 'test', extract: async () => extraction }]);
}

async function capturedReceipt(db: ReturnType<typeof createTestDb>, draftJson = '{}') {
  await db.insert(inboxItems).values({
    id: 'r1',
    kind: 'receipt',
    state: 'captured',
    draftJson,
    createdAt: T,
    updatedAt: T,
  });
}

async function draftOf(db: ReturnType<typeof createTestDb>) {
  const [row] = await db.select().from(inboxItems).where(eq(inboxItems.id, 'r1'));
  return JSON.parse(row!.draftJson);
}

describe('parseReceiptItem payee', () => {
  it('sets merchant as a new payee, as read', async () => {
    const db = createTestDb();
    await capturedReceipt(db);
    readingAs('Some New Shop');

    await parseReceiptItem(db as any, 'r1', 'base64');

    const draft = await draftOf(db);
    expect(draft).toMatchObject({ destinationName: 'Some New Shop', isNewPayee: true });
    expect(draft.payeeReadAs).toBeUndefined();
  });
});

describe('parseReceiptItem date', () => {
  it('dates a receipt with no printed date by its photo, not by when it was read', async () => {
    const db = createTestDb();
    const takenAt = '2026-09-20T16:45:00.000Z';
    await capturedReceipt(
      db,
      writeDraft({
        type: 'withdrawal',
        amount: '',
        currencyCode: '',
        date: takenAt,
        description: '',
        isNewPayee: true,
      }),
    );
    readingAs('Kiosk', { date: null, time: null });

    await parseReceiptItem(db as any, 'r1', 'base64');

    expect((await draftOf(db)).date).toBe(takenAt);
  });

  it('falls back to when the receipt was captured when its stub has no date', async () => {
    const db = createTestDb();
    await capturedReceipt(db);
    readingAs('Kiosk', { date: null, time: null });

    await parseReceiptItem(db as any, 'r1', 'base64');

    expect((await draftOf(db)).date).toBe(new Date(T).toISOString());
  });

  it('creates extra inbox items for currency exchange fee withdrawal', async () => {
    const db = createTestDb();
    await db.insert(inboxItems).values({
      id: 'r1',
      kind: 'receipt',
      state: 'captured',
      draftJson: '{}',
      receiptImagePath: 'file:///receipts/exchange.jpg',
      createdAt: T,
      updatedAt: T,
    });

    const extraction: ReceiptExtraction = {
      amount: '100.00',
      currency: 'EUR',
      merchant: 'Kantor',
      date: '2026-09-27',
      time: '10:00',
      category: null,
      items: [],
      currencyExchanges: [
        {
          fromAmount: '100.00',
          fromCurrency: 'EUR',
          toAmount: '430.00',
          toCurrency: 'PLN',
          feeAmount: '5.00',
          feeCurrency: 'PLN',
        },
      ],
      confidence: 0.9,
      paymentMethod: 'cash',
      cardNetwork: null,
    };
    (buildChain as jest.Mock).mockResolvedValue([
      { name: 'test', extract: async () => extraction },
    ]);

    const outcome = await parseReceiptItem(db as any, 'r1', 'base64');
    expect(outcome).toBe('parsed');

    const allItems = await db.select().from(inboxItems);
    expect(allItems).toHaveLength(2);

    const primary = allItems.find((i) => i.id === 'r1')!;
    expect(primary.state).toBe('parsed');
    const primaryDraft = JSON.parse(primary.draftJson);
    expect(primaryDraft.type).toBe('transfer');
    expect(primaryDraft.amount).toBe('100.00');
    expect(primaryDraft.foreignAmount).toBe('430.00');

    const extra = allItems.find((i) => i.id !== 'r1')!;
    expect(extra.state).toBe('parsed');
    expect(extra.receiptImagePath).toBe('file:///receipts/exchange.jpg');
    const extraDraft = JSON.parse(extra.draftJson);
    expect(extraDraft.type).toBe('withdrawal');
    expect(extraDraft.amount).toBe('5.00');
  });
});
