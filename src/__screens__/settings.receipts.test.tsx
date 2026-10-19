// Settings → Receipt reading: the local model's name row opens its sheet, and Save writes the name
// through setLocalModelName into the same SQLite the app uses (src/db/testDb.ts). Its strings that
// are new are not in en.json yet, so these tests look them up by key (i18n.t) rather than by their
// English text, and assert on the stored values.
import { Alert } from 'react-native';
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import i18n from '../i18n';
import { createTestDb } from '../db/testDb';
import { getLocalModelName, getReceiptReader, setLocalModelName } from '../settings/appSettings';
import { deleteGeminiKey, readGeminiKey } from '../settings/secrets';
import ReceiptsScreen from '../../app/settings/receipts';

// `mock`-prefixed so Jest's hoisting lets the factories below close over it.
let mockDb: ReturnType<typeof createTestDb>;

jest.mock('../providers/DbProvider', () => ({ useDb: () => mockDb }));

// expo-router pulls in an untransformed ESM dependency under Jest; the navigation isn't under test.
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
}));

// Signed out: the page reads the stored settings, nothing else.
jest.mock('../api/ff3/auth', () => ({
  readStoredCredentials: jest.fn(async () => null),
  signOut: jest.fn(),
  probeAbout: jest.fn(),
  signIn: jest.fn(),
}));

// The Gemini key lives in SecureStore; the tests say whether one is saved and record the delete.
jest.mock('../settings/secrets', () => ({
  readGeminiKey: jest.fn(async () => null),
  saveGeminiKey: jest.fn(async () => undefined),
  deleteGeminiKey: jest.fn(async () => undefined),
}));

jest.mock('../receipt/testReaders', () => {
  const actual = jest.requireActual('../receipt/testReaders');
  return {
    ...actual,
    testReaders: jest.fn(async () => ({
      local: { status: 'ok', seconds: '1.2' },
      gemini: { status: 'error', messageKey: 'testKeyRejected' },
    })),
  };
});

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

// The first render of a screen is slow under Jest; the default 1s waits would give up on it.
configure({ asyncUtilTimeout: 10_000 });

/** Resolves once the stored settings are read: until then the model name row shows "not set". */
async function renderScreen() {
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: {
              queries: { retry: false, gcTime: Infinity },
              mutations: { gcTime: Infinity },
            },
          })
        }
      >
        <ReceiptsScreen />
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  await waitFor(() => expect(screen.getByText('qwen3-vl-8b')).toBeTruthy());
}

beforeEach(async () => {
  jest.clearAllMocks();
  (readGeminiKey as jest.Mock).mockResolvedValue(null);
  mockDb = createTestDb();
  await setLocalModelName(mockDb, 'qwen3-vl-8b');
});

describe('Settings → Receipt reading', () => {
  it('opens the local model sheet from the model name row', async () => {
    await renderScreen();

    fireEvent.press(screen.getByText('qwen3-vl-8b'));

    await waitFor(() => expect(screen.getByDisplayValue('qwen3-vl-8b')).toBeTruthy());
  });

  it('saving a changed name writes it through setLocalModelName', async () => {
    await renderScreen();
    fireEvent.press(screen.getByText('qwen3-vl-8b'));
    await waitFor(() => expect(screen.getByDisplayValue('qwen3-vl-8b')).toBeTruthy());

    fireEvent.changeText(screen.getByDisplayValue('qwen3-vl-8b'), 'qwen3-vl-9b');
    await waitFor(() => expect(screen.getByDisplayValue('qwen3-vl-9b')).toBeTruthy());
    fireEvent.press(screen.getByText('Save'));

    await waitFor(async () => expect(await getLocalModelName(mockDb)).toBe('qwen3-vl-9b'));
  });

  it('choosing a "Who reads your photos" option stores it', async () => {
    await renderScreen();
    expect(await getReceiptReader(mockDb)).toBe('auto');

    fireEvent.press(screen.getByText(i18n.t('receiptSettings.readerLocal')));
    await waitFor(async () => expect(await getReceiptReader(mockDb)).toBe('local'));

    fireEvent.press(screen.getByText(i18n.t('receiptSettings.readerNone')));
    await waitFor(async () => expect(await getReceiptReader(mockDb)).toBe('none'));
  });

  it('displays masked API key and Remove key inside sheet deletes after confirm', async () => {
    (readGeminiKey as jest.Mock).mockResolvedValue('AIzaSyD-1234');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await renderScreen();

    // Masked tail is shown on main screen
    expect(screen.getByText('•••• 1234')).toBeTruthy();

    // Tap API key row to open sheet
    fireEvent.press(screen.getByText('•••• 1234'));
    await waitFor(() => expect(screen.getByText(i18n.t('receiptSettings.removeKey'))).toBeTruthy());

    fireEvent.press(screen.getByText(i18n.t('receiptSettings.removeKey')));
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
    const [title, , buttons] = alert.mock.calls[0]!;
    expect(title).toBe(i18n.t('receiptSettings.removeKeyTitle'));
    expect(deleteGeminiKey).not.toHaveBeenCalled();

    // Cancel leaves the key where it is.
    buttons!.find((b) => b.text === i18n.t('common.cancel'))!.onPress?.();
    await waitFor(() => expect(screen.getByText(i18n.t('receiptSettings.removeKey'))).toBeTruthy());
    expect(deleteGeminiKey).not.toHaveBeenCalled();

    // Confirming it deletes the key
    fireEvent.press(screen.getByText(i18n.t('receiptSettings.removeKey')));
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(2));
    (readGeminiKey as jest.Mock).mockResolvedValue(null);
    const verb = alert.mock.calls[1]![2]!.find(
      (b) => b.text === i18n.t('receiptSettings.removeKeyVerb'),
    );
    verb!.onPress?.();

    await waitFor(() => expect(deleteGeminiKey).toHaveBeenCalledTimes(1));
    alert.mockRestore();
  });

  it('runs "Test both now" and displays results in Review Sheet C', async () => {
    await renderScreen();

    fireEvent.press(screen.getByText(i18n.t('receiptSettings.testBothNow')));

    // Review sheet opens with test results
    await waitFor(() => expect(screen.getByText(i18n.t('receiptSettings.testTitle'))).toBeTruthy());
    expect(
      screen.getByText(i18n.t('receiptSettings.testModelAnswered', { seconds: '1.2' })),
    ).toBeTruthy();
    expect(screen.getByText(i18n.t('receiptSettings.testKeyRejected'))).toBeTruthy();
  });
});
