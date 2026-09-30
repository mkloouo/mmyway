// The e2e sign-in route (app/e2e-sign-in.tsx): a link that signs the app in to any server it names,
// so the test that matters most is that a real build ignores it.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../i18n';
import E2eSignIn from '../../app/e2e-sign-in';
import { connectToInstance } from '../settings/connectInstance';

const mockConfig: { variant: string | undefined } = { variant: 'development' };
const mockParams: { current: Record<string, string | string[]> } = { current: {} };
const mockRouter = { canGoBack: jest.fn(() => true), back: jest.fn(), replace: jest.fn() };
const mockCredentialsChanged = jest.fn();

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { extra: { appVariant: mockConfig.variant } };
    },
  },
}));
jest.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => {
    const { createElement } = jest.requireActual('react');
    const { Text } = jest.requireActual('react-native');
    return createElement(Text, null, `redirected to ${href}`);
  },
  router: {
    canGoBack: () => mockRouter.canGoBack(),
    back: () => mockRouter.back(),
    replace: (href: string) => mockRouter.replace(href),
  },
  useLocalSearchParams: () => mockParams.current,
}));
jest.mock('../providers/DbProvider', () => ({ useDb: () => ({}) }));
jest.mock('../sync/useSync', () => ({
  useSync: () => ({ credentialsChanged: mockCredentialsChanged }),
}));
jest.mock('../settings/connectInstance', () => ({
  ...jest.requireActual('../settings/connectInstance'),
  connectToInstance: jest.fn(),
}));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
function open() {
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <QueryClientProvider client={new QueryClient()}>
        <E2eSignIn />
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
}

describe('the e2e sign-in link', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.variant = 'development';
    mockParams.current = { host: 'http://localhost:8080', token: 'tok' };
  });

  it('signs the Dev build in with the address and token in the link, and waits to be dismissed', async () => {
    (connectToInstance as jest.Mock).mockResolvedValue({ status: 'connected' });

    await open();

    expect(await screen.findByText('Connected to Firefly III')).toBeTruthy();
    expect(connectToInstance).toHaveBeenCalledWith(
      expect.anything(),
      'http://localhost:8080',
      'tok',
    );
    expect(mockCredentialsChanged).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByText('Done'));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('says why it could not sign in, and signs in nothing else', async () => {
    (connectToInstance as jest.Mock).mockResolvedValue({
      status: 'failed',
      reason: 'invalid_api_key',
    });

    await open();

    expect(await screen.findByText('Sign-in failed')).toBeTruthy();
    expect(screen.getByText('That token was rejected — check it was copied in full.')).toBeTruthy();
    expect(mockCredentialsChanged).not.toHaveBeenCalled();
  });

  it.each(['production', undefined])(
    'is ignored by a build whose variant is %p: home, and the link is never read',
    async (variant) => {
      mockConfig.variant = variant;

      await open();

      expect(await screen.findByText('redirected to /')).toBeTruthy();
      expect(connectToInstance).not.toHaveBeenCalled();
      expect(mockCredentialsChanged).not.toHaveBeenCalled();
    },
  );
});
