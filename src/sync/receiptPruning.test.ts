import { eq } from 'drizzle-orm';
import { createTestDb } from '../db/testDb';
import { inboxItems } from '../db/schema';
import { deletePersistedReceiptImage } from '../receipt/imageFiles';
import { enqueueOperation } from './outbox';
import { pruneUploadedReceiptImages } from './receiptPruning';

jest.mock('../receipt/imageFiles', () => ({ deletePersistedReceiptImage: jest.fn() }));

beforeEach(() => jest.clearAllMocks());

it('keeps a shared exchange photo until every draft has released it', async () => {
  const db = createTestDb();
  const path = 'file:///receipts/exchange.jpg';
  const base = {
    kind: 'receipt' as const,
    draftJson: '{}',
    createdAt: '2026-08-01',
    updatedAt: '2026-08-01',
    receiptImagePath: path,
  };
  await db.insert(inboxItems).values([
    { ...base, id: 'transfer', state: 'synced' },
    { ...base, id: 'fee', state: 'parsed' },
  ]);
  await pruneUploadedReceiptImages(db, new Date('2026-10-28'));
  expect(deletePersistedReceiptImage).not.toHaveBeenCalled();
  expect(
    (await db.select().from(inboxItems).where(eq(inboxItems.id, 'fee')))[0]?.receiptImagePath,
  ).toBe(path);
  await db.update(inboxItems).set({ state: 'synced' }).where(eq(inboxItems.id, 'fee'));
  await pruneUploadedReceiptImages(db, new Date('2026-10-28'));
  expect(deletePersistedReceiptImage).toHaveBeenCalledTimes(1);
  expect(deletePersistedReceiptImage).toHaveBeenCalledWith(path);
});

it('keeps a photo used by a queued upload without an Inbox link', async () => {
  const db = createTestDb();
  const path = 'file:///receipts/shared.jpg';
  await db.insert(inboxItems).values({
    id: 'old',
    kind: 'receipt',
    state: 'synced',
    draftJson: '{}',
    createdAt: '2026-08-01',
    updatedAt: '2026-08-01',
    receiptImagePath: path,
  });
  await enqueueOperation(db, {
    id: 'upload',
    kind: 'attach_receipt',
    payload: { transactionJournalId: 'j1', receiptImagePath: path },
  });
  await pruneUploadedReceiptImages(db, new Date('2026-10-28'));
  expect(deletePersistedReceiptImage).not.toHaveBeenCalled();
});
