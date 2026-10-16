import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../i18n';
import ProxyRoute from '../../app/settings/proxy';
import * as proxyHeaders from '../api/ff3/proxyHeaders';
import * as confirm from '../ui/confirm';

jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
}));

jest.mock('../../src/flags/RequireFlag', () => ({
  RequireFlag: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../api/ff3/proxyHeaders', () => {
  const actual = jest.requireActual('../api/ff3/proxyHeaders');
  return {
    ...actual,
    loadProxyHeaders: jest.fn(async () => ({})),
    writeProxyHeaders: jest.fn(async () => undefined),
  };
});

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderScreen() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <QueryClientProvider client={queryClient}>
        <ProxyRoute />
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
}

describe('Proxy screen (Board 30)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders header, explainer, Cloudflare button, and empty state', async () => {
    (proxyHeaders.loadProxyHeaders as jest.Mock).mockResolvedValueOnce({});
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Reverse proxy')).toBeTruthy();
    });

    expect(
      screen.getByText(
        'Only needed if something like Cloudflare Access stands in front of Firefly III. These headers go with every request, sign-in included, and are stored as safely as your token.',
      ),
    ).toBeTruthy();

    expect(screen.getByText('Headers')).toBeTruthy();
    expect(screen.getByText('Use Cloudflare Access')).toBeTruthy();
    expect(screen.getByText('+ Add a header')).toBeTruthy();
    expect(
      screen.getByText(
        'Using HTTP Basic? Put it in the address instead: https://user:password@your-host.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Remove all')).toBeTruthy();
    expect(screen.getByText('Save')).toBeTruthy();
  });

  it('populates Cloudflare Access pair when action tapped', async () => {
    (proxyHeaders.loadProxyHeaders as jest.Mock).mockResolvedValueOnce({});
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Use Cloudflare Access')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('Use Cloudflare Access'));

    await waitFor(() => {
      expect(screen.getByDisplayValue('CF-Access-Client-Id')).toBeTruthy();
      expect(screen.getByDisplayValue('CF-Access-Client-Secret')).toBeTruthy();
    });
  });

  it('+ Add a header adds an empty row pair and remove button removes it', async () => {
    (proxyHeaders.loadProxyHeaders as jest.Mock).mockResolvedValueOnce({});
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('+ Add a header')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('+ Add a header'));

    await waitFor(() => {
      expect(screen.getAllByText('Name').length).toBe(1);
      expect(screen.getAllByText('Value').length).toBe(1);
      expect(screen.getByText('Remove')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('Remove'));

    await waitFor(() => {
      expect(screen.queryByText('Remove')).toBeNull();
    });
  });

  it('validates header problems and saves valid headers', async () => {
    (proxyHeaders.loadProxyHeaders as jest.Mock).mockResolvedValueOnce({
      'X-Custom': 'Secret123',
    });
    renderScreen();

    await waitFor(() => {
      expect(screen.getByDisplayValue('X-Custom')).toBeTruthy();
      expect(screen.getByDisplayValue('Secret123')).toBeTruthy();
    });

    // Save button should be enabled
    const saveBtn = screen.getByRole('button', { name: 'Save' });
    expect(saveBtn.props.accessibilityState?.disabled).toBeFalsy();

    fireEvent.press(saveBtn);

    await waitFor(() => {
      expect(proxyHeaders.writeProxyHeaders).toHaveBeenCalledWith({
        'X-Custom': 'Secret123',
      });
    });
  });

  it('shows hint when header name is invalid', async () => {
    (proxyHeaders.loadProxyHeaders as jest.Mock).mockResolvedValueOnce({
      'Bad Header': 'val',
    });
    renderScreen();

    await waitFor(() => {
      expect(screen.getByDisplayValue('Bad Header')).toBeTruthy();
    });

    // Save should be disabled with problem hint
    await waitFor(() => {
      expect(
        screen.getByText(
          "A header name can only use letters, digits and - ! # $ % & ' * + . ^ _ ` | ~",
        ),
      ).toBeTruthy();
    });
  });

  it('clears all headers with confirmation', async () => {
    jest.spyOn(confirm, 'confirmDestructive').mockResolvedValueOnce(true);
    (proxyHeaders.loadProxyHeaders as jest.Mock).mockResolvedValueOnce({
      'CF-Access-Client-Id': 'id123',
    });
    renderScreen();

    await waitFor(() => {
      expect(screen.getByDisplayValue('CF-Access-Client-Id')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('Remove all'));

    await waitFor(() => {
      expect(confirm.confirmDestructive).toHaveBeenCalled();
      expect(proxyHeaders.writeProxyHeaders).toHaveBeenCalledWith({});
      expect(screen.queryByDisplayValue('CF-Access-Client-Id')).toBeNull();
    });
  });
});
