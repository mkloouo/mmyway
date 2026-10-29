import { act, renderHook, waitFor } from '@testing-library/react-native';
import { createTestDb } from '../db/testDb';
import { inboxItems, outboxOperations, referenceAccounts } from '../db/schema';
import { useCaptureSave } from './useCaptureSave';
import { useAction } from '../ui/useAction';
import { persistReceiptImage, deletePersistedReceiptImage } from '../receipt/imageFiles';
import { readDraft } from '../inbox/draftJson';

jest.mock('../receipt/imageFiles', () => ({
  persistReceiptImage: jest.fn(() => 'file:///receipts/photo.jpg'),
  deletePersistedReceiptImage: jest.fn(),
}));
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

async function capture(photoUri: string | null = null) {
  const db = createTestDb();
  const account = { id: 'wallet', name: 'Wallet', currencyCode: 'PLN' };
  await db
    .insert(referenceAccounts)
    .values({ ...account, type: 'asset', active: true, syncedAt: 'now' });
  const markSaved = jest.fn();
  const setToast = jest.fn();
  const onTick = jest.fn();
  const { result } = await renderHook(() => {
    const action = useAction();
    return useCaptureSave({
      db,
      assetAccounts: [account],
      currency: { symbol: 'zł', decimalPlaces: 2 },
      effectiveCurrencyCode: 'PLN',
      effectiveSourceId: account.id,
      sourceAccount: account,
      destinationAccount: undefined,
      type: 'withdrawal',
      amount: '15.00',
      date: new Date('2026-10-01'),
      dateMode: 'today',
      description: 'Purchase',
      merchantRawInput: 'Shop',
      forceNewPayee: true,
      destinationId: null,
      categoryName: null,
      budgetId: null,
      notes: '',
      tags: [],
      sharedWith: '',
      photoUri,
      showFx: false,
      accountCurrencyCode: 'PLN',
      parsedForeignAmount: '',
      foreignAmountInvalid: false,
      fxMissing: false,
      isDirty: true,
      act: action,
      isSaving: action.pending('Save'),
      shake: jest.fn(),
      fly: jest.fn(),
      onTick,
      onWarn: jest.fn(),
      setToast,
      markSaved,
    });
  });
  return { db, result, markSaved, setToast, onTick };
}

it('Save to Inbox creates a draft without sending; Save & confirm debounces double taps and supports Undo', async () => {
  const first = await capture();
  await act(async () => {
    first.result.current.handleSave(false);
  });
  await waitFor(() => expect(first.markSaved).toHaveBeenCalledTimes(1));
  expect(await first.db.select().from(outboxOperations)).toHaveLength(0);
  expect((await first.db.select().from(inboxItems))[0]!.state).toBe('captured');

  const second = await capture();
  await act(async () => {
    second.result.current.handleSave(true);
    second.result.current.handleSave(true);
  });
  await waitFor(() => expect(second.markSaved).toHaveBeenCalledTimes(1));
  expect(await second.db.select().from(inboxItems)).toHaveLength(1);
  expect(await second.db.select().from(outboxOperations)).toHaveLength(1);
  await act(async () => {
    second.result.current.snackbar!.onAction();
  });
  await waitFor(() => expect(second.setToast).toHaveBeenCalled());
  expect(await second.db.select().from(outboxOperations)).toHaveLength(0);
  expect((await second.db.select().from(inboxItems))[0]!.state).toBe('captured');
});

it('a failed Save & confirm leaves no duplicate draft or copied photo, and retry saves once', async () => {
  const { db, result, setToast, markSaved, onTick } = await capture('file:///cache/photo.jpg');
  db.run(
    "CREATE TRIGGER fail_confirm BEFORE INSERT ON outbox_operations BEGIN SELECT RAISE(ABORT, 'disk full'); END",
  );
  await act(async () => {
    result.current.handleSave(true);
  });
  await waitFor(() => expect(setToast).toHaveBeenCalled());
  expect(markSaved).not.toHaveBeenCalled();
  expect(onTick).not.toHaveBeenCalled();
  expect(await db.select().from(inboxItems)).toHaveLength(0);
  expect(await db.select().from(outboxOperations)).toHaveLength(0);
  expect(deletePersistedReceiptImage).toHaveBeenCalledWith('file:///receipts/photo.jpg');
  db.run('DROP TRIGGER fail_confirm');
  await act(async () => {
    result.current.handleSave(true);
  });
  await waitFor(() => expect(markSaved).toHaveBeenCalledTimes(1));
  expect(await db.select().from(inboxItems)).toEqual([
    expect.objectContaining({ state: 'confirmed', receiptImagePath: 'file:///receipts/photo.jpg' }),
  ]);
  expect(await db.select().from(outboxOperations)).toHaveLength(1);
});

it('a failed photo copy creates no draft and leaves the form available for retry', async () => {
  const { db, result, setToast, markSaved } = await capture('file:///cache/photo.jpg');
  (persistReceiptImage as jest.Mock).mockImplementationOnce(() => {
    throw new Error('photo unavailable');
  });
  await act(async () => {
    result.current.handleSave(true);
  });
  await waitFor(() => expect(setToast).toHaveBeenCalled());
  expect(markSaved).not.toHaveBeenCalled();
  expect(await db.select().from(inboxItems)).toHaveLength(0);
});

it('uses the time of saving when Capture stays open in Today mode', async () => {
  jest.useFakeTimers({ now: new Date('2026-10-28T12:00:00Z') });
  const { db, result, markSaved } = await capture();
  jest.setSystemTime(new Date('2026-10-28T13:00:00Z'));
  await act(async () => {
    result.current.handleSave(true);
  });
  expect(markSaved).toHaveBeenCalledTimes(1);
  const [item] = await db.select().from(inboxItems);
  expect(readDraft(item!.draftJson).date).toBe('2026-10-28T13:00:00.000Z');
});
