import { eq } from 'drizzle-orm';
import { createTestDb } from '../db/testDb';
import { inboxItems } from '../db/schema';
import { upsertAlias } from '../lookup/aliases';
import { parseReceiptItem } from './toDraft';
import { buildChain } from './buildChain';
import type { ReceiptExtraction } from './types';

jest.mock('./buildChain', () => ({ buildChain: jest.fn() }));
jest.mock('../utils/log', () => ({ logLine: jest.fn() }));

const T = '2026-09-27T10:00:00Z';

function readingAs(merchant: string) {
  const extraction: ReceiptExtraction = {
    amount: '12.50',
    currency: null,
    merchant,
    date: '2026-09-27',
    time: '10:00',
    category: null,
    items: [],
    confidence: 0.9,
    paymentMethod: 'unknown',
    cardNetwork: null,
  };
  (buildChain as jest.Mock).mockResolvedValue([{ name: 'test', extract: async () => extraction }]);
}

async function capturedReceipt(db: ReturnType<typeof createTestDb>) {
  await db.insert(inboxItems).values({
    id: 'r1',
    kind: 'receipt',
    state: 'captured',
    draftJson: '{}',
    createdAt: T,
    updatedAt: T,
  });
}

async function draftOf(db: ReturnType<typeof createTestDb>) {
  const [row] = await db.select().from(inboxItems).where(eq(inboxItems.id, 'r1'));
  return JSON.parse(row!.draftJson);
}

describe('parseReceiptItem payee aliases', () => {
  it('books a merchant corrected before to the payee it was corrected to', async () => {
    const db = createTestDb();
    await capturedReceipt(db);
    await upsertAlias(db, {
      kind: 'payee',
      rawInput: 'ZABKA POLSKA SP Z O O',
      targetId: null,
      targetName: 'Żabka',
    });
    readingAs('ZABKA POLSKA SP. Z O.O.');

    expect(await parseReceiptItem(db as any, 'r1', 'base64')).toBe('parsed');

    expect(await draftOf(db)).toMatchObject({
      destinationName: 'Żabka',
      isNewPayee: false,
      payeeReadAs: 'ZABKA POLSKA SP. Z O.O.',
    });
  });

  it('leaves a merchant with no alias as a new payee, as read', async () => {
    const db = createTestDb();
    await capturedReceipt(db);
    readingAs('Some New Shop');

    await parseReceiptItem(db as any, 'r1', 'base64');

    const draft = await draftOf(db);
    expect(draft).toMatchObject({ destinationName: 'Some New Shop', isNewPayee: true });
    expect(draft.payeeReadAs).toBeUndefined();
  });
});
