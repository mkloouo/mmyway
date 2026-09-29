import { createTestDb } from '../../db/testDb';
import { clientFor, getClient, resetClient } from './session';

// jest.mock is hoisted above the imports; the factory reads mockStore lazily, at call time.
const mockStore: Record<string, string> = {};
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore[k] ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    mockStore[k] = v;
  }),
}));

function okResponse() {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => ({ data: { api_version: '6.3.2' } }),
    text: async () => '',
  };
}

describe('session', () => {
  let lanUp: boolean;
  beforeEach(() => {
    resetClient();
    lanUp = true;
    mockStore.ff3_hosts = JSON.stringify(['http://lan.local', 'https://tailnet.example']);
    mockStore.ff3_api_token = 'tok';
    (global as any).fetch = jest.fn(async (url: string) => {
      if (url.startsWith('http://lan.local') && !lanUp)
        throw new TypeError('Network request failed');
      return okResponse();
    });
  });

  it('re-resolves after the memoised address stops answering (leaving home Wi-Fi)', async () => {
    const db = createTestDb();
    const first = await getClient(db as any);
    await first!.request('/v1/about');

    lanUp = false;
    await expect(first!.request('/v1/about')).rejects.toThrow('Network request failed');

    const second = await getClient(db as any);
    expect(second).not.toBe(first);
    await expect(second!.request('/v1/about')).resolves.toBeDefined();
    expect((global as any).fetch).toHaveBeenLastCalledWith(
      'https://tailnet.example/api/v1/about',
      expect.anything(),
    );
  });

  it('a new token for the same host gets a new client', () => {
    const a = clientFor('https://ff3.example', 'old-token');
    expect(clientFor('https://ff3.example', 'old-token')).toBe(a);
    expect(clientFor('https://ff3.example', 'new-token')).not.toBe(a);
  });
});
