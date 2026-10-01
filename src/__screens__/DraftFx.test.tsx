import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { ReactElement } from 'react';
import '../i18n';
import { DraftEditor } from '../../app/draft/[id]';
import { writeDraft } from '../inbox/draftJson';
import { updateDraft } from '../inbox/updateDraft';
import type { InboxItemRow } from '../inbox/useInboxSections';

jest.setTimeout(15_000);

const mockUpdateDraft = updateDraft as jest.MockedFunction<typeof updateDraft>;

jest.mock('../../src/providers/DbProvider', () => ({
  useDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({}),
      }),
    }),
  }),
}));

const mockAccounts = [
  { id: 'acc-pln', name: 'PLN Account', currencyCode: 'PLN', type: 'asset', active: true },
  { id: 'acc-eur', name: 'EUR Account', currencyCode: 'EUR', type: 'asset', active: true },
];

jest.mock('../../src/accounts/useAssetAccounts', () => ({
  useAssetAccounts: () => mockAccounts,
}));

jest.mock('../../src/db/useReferenceData', () => ({
  useCurrencyRows: () => [
    { code: 'EUR', symbol: '€', decimalPlaces: 2 },
    { code: 'PLN', symbol: 'zł', decimalPlaces: 2 },
  ],
  useCategories: () => [],
  useBudgetRows: () => [],
}));

jest.mock('../../src/db/useLiveQuery', () => ({
  useLiveQuery: () => ({ data: [] }),
}));

jest.mock('../../src/lookup/useMerchantHistories', () => ({
  useMerchantHistories: () => [],
}));

jest.mock('../../src/inbox/updateDraft', () => ({
  updateDraft: jest.fn().mockResolvedValue(undefined),
  deleteInboxItem: jest.fn(),
  attachReceiptImage: jest.fn(),
}));

jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
  useLocalSearchParams: () => ({ id: 'item-1' }),
}));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function wrap(ui: ReactElement) {
  return render(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);
}

function createItem(draft: Record<string, unknown>): InboxItemRow {
  return {
    id: 'item-1',
    kind: 'receipt',
    state: 'parsed',
    createdAt: '2026-09-29T10:00:00Z',
    updatedAt: '2026-09-29T10:00:00Z',
    receiptImagePath: null,
    receiptContentHash: null,
    ff3GroupId: null,
    errorMessage: null,
    draftJson: writeDraft({
      type: 'withdrawal',
      amount: '20.00',
      currencyCode: 'EUR',
      date: '2026-09-29T10:00:00Z',
      description: 'Lidl',
      destinationName: 'Lidl',
      isNewPayee: false,
      sourceId: 'acc-pln',
      ...draft,
    }),
  } as InboxItemRow;
}

describe('DraftScreen FX conversion (#105)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('appears when currencies differ and asks what the account was charged', async () => {
    const item = createItem({ currencyCode: 'EUR', sourceId: 'acc-pln' });
    await wrap(<DraftEditor row={item} />);

    expect(screen.getByText('Account charged')).toBeTruthy();
    expect(screen.getByText('— PLN')).toBeTruthy();
    expect(screen.getByText('Enter what the PLN account paid')).toBeTruthy();
  });

  it('disappears when currencies match', async () => {
    const item = createItem({ currencyCode: 'EUR', sourceId: 'acc-eur' });
    await wrap(<DraftEditor row={item} />);

    expect(screen.queryByText('Account charged')).toBeNull();
    expect(screen.queryByText('Enter what the EUR account paid')).toBeNull();
  });

  it('saves the converted amount through updateDraft', async () => {
    const item = createItem({ currencyCode: 'EUR', sourceId: 'acc-pln' });
    await wrap(<DraftEditor row={item} />);

    await fireEvent.press(screen.getByText('Account charged'));
    expect(screen.getByText(/Amount/i)).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('9'));
    await fireEvent.press(screen.getByLabelText('0'));
    await fireEvent.press(screen.getByLabelText('Done'));

    expect(mockUpdateDraft).toHaveBeenCalledWith(
      expect.anything(),
      'item-1',
      expect.objectContaining({
        foreignAmount: '90',
        foreignCurrencyCode: 'PLN',
      }),
    );
  });

  it('shows the implied exchange rate when foreign amount is present', async () => {
    const item = createItem({
      currencyCode: 'EUR',
      amount: '20.00',
      sourceId: 'acc-pln',
      foreignAmount: '90.00',
      foreignCurrencyCode: 'PLN',
    });
    await wrap(<DraftEditor row={item} />);

    expect(screen.getByText('90.00 PLN')).toBeTruthy();
    expect(screen.getByText(/1 EUR ≈ 4\.50 PLN/)).toBeTruthy();
  });

  it('changing the account clears the conversion entered for the old pair', async () => {
    const item = createItem({
      currencyCode: 'EUR',
      sourceId: 'acc-pln',
      foreignAmount: '90.00',
      foreignCurrencyCode: 'PLN',
    });
    await wrap(<DraftEditor row={item} />);

    // Open account picker by tapping the From account row
    await fireEvent.press(screen.getByText('PLN Account'));
    // Select EUR Account
    await fireEvent.press(screen.getByText('EUR Account'));

    expect(mockUpdateDraft).toHaveBeenCalledWith(
      expect.anything(),
      'item-1',
      expect.objectContaining({
        sourceId: 'acc-eur',
        foreignAmount: undefined,
        foreignCurrencyCode: undefined,
      }),
    );
  });
});
