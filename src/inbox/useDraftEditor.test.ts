import { act, renderHook } from '@testing-library/react-native';
import { createTestDb } from '../db/testDb';
import { inboxItems, outboxOperations } from '../db/schema';
import { useDraftEditor } from './useDraftEditor';
import { useAction } from '../ui/useAction';
import { readDraft, writeDraft } from './draftJson';
import type { Draft } from './draft';
import { readPayload } from '../sync/payloadJson';
import type { CreateTransactionPayload } from '../sync/outbox';

const draft: Draft = {
  type: 'withdrawal',
  amount: '15.00',
  currencyCode: 'EUR',
  foreignAmount: '65.00',
  foreignCurrencyCode: 'PLN',
  sourceId: 'pln',
  destinationName: 'Shop',
  isNewPayee: true,
  date: '2026-10-28T12:00:00Z',
  description: 'Shopping',
};
const assetAccounts = [
  { id: 'pln', name: 'Wallet', currencyCode: 'PLN' },
  { id: 'eur', name: 'Savings', currencyCode: 'EUR' },
];

async function editor(initial: Draft = draft, readinessReady = true) {
  const db = createTestDb();
  await db.insert(inboxItems).values({
    id: 'draft',
    kind: 'receipt',
    state: 'parsed',
    draftJson: writeDraft(initial),
    createdAt: 'now',
    updatedAt: 'now',
  });
  const onBack = jest.fn();
  const onError = jest.fn();
  const { result } = await renderHook(() =>
    useDraftEditor({
      db,
      id: 'draft',
      draft: initial,
      assetAccounts,
      payeeName: initial.type === 'deposit' ? initial.sourceName : initial.destinationName,
      readinessReady,
      pendingCreateId: null,
      act: useAction(onError),
      shake: jest.fn(),
      onTick: jest.fn(),
      onWarn: jest.fn(),
      onCloseSheet: jest.fn(),
      onBack,
      confirmDestructive: async () => true,
      setSnackbar: jest.fn(),
    }),
  );
  const saved = async () => readDraft((await db.select().from(inboxItems))[0]!.draftJson);
  return { db, result, saved, onBack, onError };
}

it('keeps the entered conversion when correcting the payee read by an LLM', async () => {
  const { result, saved } = await editor();
  await act(async () => {
    await result.current.choosePayee(draft, 'Correct shop', false);
  });
  expect(await saved()).toMatchObject({
    destinationName: 'Correct shop',
    foreignAmount: '65.00',
    foreignCurrencyCode: 'PLN',
  });
});

it('keeps the extracted conversion when selecting the missing destination of an exchange', async () => {
  const { result, saved } = await editor({
    ...draft,
    type: 'transfer',
    sourceId: 'eur',
    destinationName: undefined,
  });
  await act(async () => {
    result.current.handleDetailChange({ destinationAccountId: 'pln' });
  });
  expect(await saved()).toMatchObject({
    destinationId: 'pln',
    foreignAmount: '65.00',
    foreignCurrencyCode: 'PLN',
  });
});

it('clears conversion when the actual currency pair changes', async () => {
  const { result, saved } = await editor();
  await act(async () => {
    result.current.handleDetailChange({ sourceAccountId: 'eur' });
  });
  expect((await saved()).foreignAmount).toBeUndefined();
});

it('saves detail edits before immediately confirming from the same rendered handler', async () => {
  const { db, result, onBack, onError } = await editor();
  await act(async () => {
    result.current.handleDetailChange({ notes: 'latest correction', categoryName: 'Travel' });
    await result.current.handleConfirm();
  });
  expect(onError).not.toHaveBeenCalled();
  expect(onBack).toHaveBeenCalledTimes(1);
  const [op] = await db.select().from(outboxOperations);
  expect(readPayload<CreateTransactionPayload>(op!.kind, op!.payloadJson).splits[0]).toMatchObject({
    notes: 'latest correction',
    category_name: 'Travel',
  });
});

it('cannot submit when the draft still needs a required field', async () => {
  const { db, result, onBack } = await editor(draft, false);
  await act(async () => {
    await result.current.handleConfirm();
  });
  expect(onBack).not.toHaveBeenCalled();
  expect(await db.select().from(outboxOperations)).toHaveLength(0);
});

it('corrects an income payer without changing its destination account or conversion', async () => {
  const income: Draft = {
    ...draft,
    type: 'deposit',
    sourceId: undefined,
    sourceName: 'Employer',
    destinationId: 'pln',
    destinationName: undefined,
  };
  const { result, saved } = await editor(income);
  await act(async () => {
    await result.current.choosePayee(income, 'Correct employer', false);
  });
  expect(await saved()).toMatchObject({
    sourceName: 'Correct employer',
    destinationId: 'pln',
    foreignAmount: '65.00',
  });
});

it.each(['withdrawal', 'deposit'] as const)(
  'selecting the account of an empty %s uses its currency and saves details',
  async (type) => {
    const { result, saved } = await editor({
      ...draft,
      type,
      amount: '',
      sourceId: undefined,
      destinationId: undefined,
    });
    await act(async () => {
      result.current.handleDetailChange({
        ...(type === 'withdrawal' ? { sourceAccountId: 'pln' } : { destinationAccountId: 'pln' }),
        categoryName: null,
        budgetId: null,
        notes: 'Reference',
        tags: ['receipt'],
        sharedWith: 'Alex',
      });
    });
    expect(await saved()).toMatchObject({
      currencyCode: 'PLN',
      notes: 'Reference',
      extraTags: ['receipt'],
      sharedWith: 'Alex',
    });
  },
);

it('saves per-split corrections while keeping the shared asset account', async () => {
  const { result, saved } = await editor({
    ...draft,
    extraSplits: [{ amount: '5', description: 'Fee', payeeName: 'Shop', isNewPayee: false }],
  });
  await act(async () => {
    result.current.handleExtraDetailChange(1, {
      categoryName: 'Fees',
      budgetId: 'b',
      notes: 'Commission',
      tags: ['fee'],
      sharedWith: 'Alex',
      sourceAccountId: 'pln',
    });
  });
  expect(await saved()).toMatchObject({
    sourceId: 'pln',
    extraSplits: [
      {
        amount: '5',
        description: 'Fee',
        categoryName: 'Fees',
        budgetId: 'b',
        notes: 'Commission',
        extraTags: ['fee'],
        sharedWith: 'Alex',
      },
    ],
  });
});
