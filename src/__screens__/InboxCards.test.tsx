// Screen-level tests (review: every bug from the first device build was on a screen). These render
// real components with React Native Testing Library; no database or network is involved.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { ReactElement } from 'react';
import '../i18n';
import { ConfirmCard } from '../ui/InboxCards';
import { writeDraft } from '../inbox/draftJson';
import type { InboxItemRow } from '../inbox/useInboxSections';

// Reanimated's swipe needs native worklets, which Jest doesn't have; the card is what's under test.
jest.mock('../ui/SwipeableCard', () => ({
  SwipeableCard: ({ children }: { children: React.ReactNode }) => children,
}));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
function wrap(ui: ReactElement) {
  return render(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);
}

function item(draft: Record<string, unknown>): InboxItemRow {
  return {
    id: 'i1',
    kind: 'manual_entry',
    state: 'captured',
    createdAt: 'c',
    updatedAt: 'u',
    receiptImagePath: null,
    receiptContentHash: null,
    ff3GroupId: null,
    errorMessage: null,
    draftJson: writeDraft({
      type: 'withdrawal',
      amount: '12.50',
      currencyCode: 'PLN',
      date: '2026-09-28T10:00:00Z',
      description: '',
      isNewPayee: false,
      sourceId: 'a1',
      sourceName: 'Revolut',
      destinationName: 'Żabka',
      ...draft,
    }),
  } as InboxItemRow;
}

const currencies = [{ code: 'PLN', symbol: 'zł', decimalPlaces: 2 }];
const selection = { active: false, selected: false, toggle: jest.fn() };

describe('Inbox confirm card', () => {
  it('shows the payee and confirms a ready draft with the ✓ button', async () => {
    const onConfirm = jest.fn();
    await wrap(
      <ConfirmCard
        item={item({})}
        currencies={currencies}
        onOpen={jest.fn()}
        onConfirm={onConfirm}
        onDelete={jest.fn()}
        selection={selection}
      />,
    );
    expect(screen.getByText('Żabka')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Confirm'));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('says what a draft still needs and offers no ✓ button', async () => {
    await wrap(
      <ConfirmCard
        item={item({ destinationName: undefined })}
        currencies={currencies}
        onOpen={jest.fn()}
        onConfirm={jest.fn()}
        onDelete={jest.fn()}
        selection={selection}
      />,
    );
    expect(screen.getByText('Needs payee')).toBeTruthy();
    expect(screen.queryByLabelText('Confirm')).toBeNull();
  });

  it('marks a payee that will be created in Firefly III', async () => {
    await wrap(
      <ConfirmCard
        item={item({ isNewPayee: true })}
        currencies={currencies}
        onOpen={jest.fn()}
        onConfirm={jest.fn()}
        onDelete={jest.fn()}
        selection={selection}
      />,
    );
    expect(screen.getByText('New payee')).toBeTruthy();
  });
});
