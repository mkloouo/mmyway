import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { ReactElement } from 'react';
import '../i18n';
import { DraftEditor } from '../../app/draft/[id]';
import { writeDraft } from '../inbox/draftJson';
import { retryErroredItem, updateDraft } from '../inbox/updateDraft';
import { requestSync } from '../sync/syncTrigger';
import type { InboxItemRow } from '../inbox/useInboxSections';

jest.setTimeout(15_000);

const mockUpdateDraft = updateDraft as jest.MockedFunction<typeof updateDraft>;
const mockRetryErroredItem = retryErroredItem as jest.MockedFunction<typeof retryErroredItem>;
const mockRequestSync = requestSync as jest.MockedFunction<typeof requestSync>;

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
  useCategories: () => [{ id: 'cat-1', name: 'Food' }],
  useBudgetRows: () => [{ id: 'b-1', name: 'Groceries' }],
}));

jest.mock('../../src/db/useLiveQuery', () => ({
  useLiveQuery: () => ({ data: [] }),
}));

jest.mock('../../src/lookup/useMerchantHistories', () => ({
  useMerchantHistories: () => [],
}));

jest.mock('../../src/sync/syncTrigger', () => ({
  requestSync: jest.fn(),
}));

jest.mock('../../src/inbox/updateDraft', () => ({
  updateDraft: jest.fn().mockResolvedValue(undefined),
  deleteInboxItem: jest.fn(),
  attachReceiptImage: jest.fn(),
  retryErroredItem: jest.fn().mockResolvedValue(undefined),
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

function createItem(draft: Record<string, unknown> = {}): InboxItemRow {
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
      currencyCode: 'PLN',
      date: '2026-09-29T10:00:00Z',
      description: 'Lidl',
      destinationName: 'Lidl',
      isNewPayee: false,
      sourceId: 'acc-pln',
      ...draft,
    }),
  };
}

describe('DraftEditor Unified Kit redesign', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders ModalHeader with Review title and More button', async () => {
    const item = createItem();
    await wrap(<DraftEditor row={item} />);

    expect(screen.getByText('Review')).toBeTruthy();
    expect(screen.getByLabelText('More')).toBeTruthy();
    expect(screen.getByLabelText('Cancel')).toBeTruthy();
  });

  it('allows changing transaction type via Segmented control', async () => {
    const item = createItem();
    await wrap(<DraftEditor row={item} />);

    await fireEvent.press(screen.getByText('Income'));

    expect(mockUpdateDraft).toHaveBeenCalledWith(
      expect.anything(),
      'item-1',
      expect.objectContaining({
        type: 'deposit',
        destinationId: 'acc-pln',
      }),
    );
  });

  it('opens More menu with Split, Currency and Delete draft', async () => {
    const item = createItem();
    await wrap(<DraftEditor row={item} />);

    await fireEvent.press(screen.getByLabelText('More'));

    expect(screen.getByText('Draft')).toBeTruthy();
    expect(screen.getByText('Split into parts')).toBeTruthy();
    expect(screen.getByText('Currency')).toBeTruthy();
    expect(screen.getByText('Delete draft')).toBeTruthy();
  });

  it('renders single Confirm button with hint when missing required fields', async () => {
    const item = createItem({ sourceId: undefined });
    await wrap(<DraftEditor row={item} />);

    expect(screen.getByText('Confirm')).toBeTruthy();
    expect(screen.getByText(/Missing/i)).toBeTruthy();
  });

  it('renders failed sync error as a status row with Retry action and triggers retry', async () => {
    const item = createItem();
    item.errorMessage = 'Network connection failed';
    await wrap(<DraftEditor row={item} />);

    expect(screen.getByText('Network connection failed')).toBeTruthy();
    const retryBtn = screen.getByText('Retry');
    expect(retryBtn).toBeTruthy();

    await fireEvent.press(retryBtn);
    expect(mockRetryErroredItem).toHaveBeenCalledWith(expect.anything(), 'item-1');
    expect(mockRequestSync).toHaveBeenCalled();
  });
});
