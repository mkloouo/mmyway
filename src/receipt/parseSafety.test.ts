import { createTestDb } from '../db/testDb';
import { inboxItems } from '../db/schema';
import { writeDraft, readDraft } from '../inbox/draftJson';
import { updateDraft } from '../inbox/updateDraft';
import { parseReceiptItem, retryPendingReceipts } from './toDraft';
import { buildChain } from './buildChain';
import { normalizeExtraction } from './providers/local';

jest.mock('./buildChain', () => ({ buildChain: jest.fn() }));
const T = '2026-10-28T12:00:00Z';
async function captured() {
  const db = createTestDb();
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
  return db;
}

afterEach(() => jest.useRealTimers());

it('never overwrites a manual correction, even when it shares the capture timestamp and sync retries', async () => {
  jest.useFakeTimers({ now: new Date(T) });
  const db = await captured();
  let finish!: (value: ReturnType<typeof normalizeExtraction>) => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  (buildChain as jest.Mock).mockResolvedValue([
    {
      name: 'test',
      model: 'test',
      extract: () => {
        started();
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    },
  ]);
  const parsing = parseReceiptItem(db, 'receipt', 'base64');
  await entered;
  await updateDraft(db, 'receipt', { amount: '25.00', description: 'Corrected' });
  finish(normalizeExtraction({ amount: '99.00', merchant: 'Wrong', confidence: 'high' }));
  expect(await parsing).toBe('waiting');
  const readImage = jest.fn(async () => 'base64');
  expect(await retryPendingReceipts(db, readImage)).toBe(0);
  expect(readImage).not.toHaveBeenCalled();
  const [item] = await db.select().from(inboxItems);
  expect(item!.state).toBe('parsed');
  expect(readDraft(item!.draftJson)).toMatchObject({ amount: '25.00', description: 'Corrected' });
});

it('rolls back every exchange draft if saving its fee fails, then retries the whole receipt', async () => {
  const db = await captured();
  (buildChain as jest.Mock).mockResolvedValue([
    {
      name: 'test',
      model: 'test',
      extract: async () =>
        normalizeExtraction({
          merchant: 'Exchange',
          confidence: 'high',
          currency_exchanges: [
            {
              from_amount: '100.00',
              from_currency: 'EUR',
              to_amount: '430.00',
              to_currency: 'PLN',
              fee_amount: '5.00',
              fee_currency: 'PLN',
            },
          ],
        }),
    },
  ]);
  db.run(
    "CREATE TRIGGER fail_fee BEFORE INSERT ON inbox_items WHEN NEW.id != 'receipt' BEGIN SELECT RAISE(ABORT, 'disk full'); END",
  );
  await expect(parseReceiptItem(db, 'receipt', 'base64')).rejects.toThrow('disk full');
  expect(await db.select().from(inboxItems)).toEqual([
    expect.objectContaining({ id: 'receipt', state: 'captured' }),
  ]);
  db.run('DROP TRIGGER fail_fee');
  expect(await parseReceiptItem(db, 'receipt', 'base64')).toBe('parsed');
  const rows = await db.select().from(inboxItems);
  expect(rows).toHaveLength(2);
  expect(rows.map((row) => readDraft(row.draftJson).amount).sort()).toEqual(['100.00', '5.00']);
});
