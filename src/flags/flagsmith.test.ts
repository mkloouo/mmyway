import { fetchFlags } from './flagsmith';

const CONFIG = { apiUrl: 'https://flags.example.com/api/v1', environmentKey: 'ser.client-key' };

function feature(name: string, enabled: boolean) {
  return { id: 1, enabled, feature: { id: 1, name, type: 'STANDARD' }, feature_state_value: null };
}

function mockFetch(response: Response) {
  return jest.fn(async () => response) as unknown as jest.MockedFunction<typeof fetch>;
}

describe('fetchFlags', () => {
  it('parses a Flagsmith response into known flag values', async () => {
    const body = [feature('budget', true), feature('ff3_rules', false)];
    const fetchImpl = mockFetch(new Response(JSON.stringify(body), { status: 200 }));
    expect(await fetchFlags(CONFIG, fetchImpl)).toEqual({ budget: true, ff3_rules: false });
  });

  it('ignores feature names that are not in the registry', async () => {
    const body = [feature('budget', true), feature('not_a_flag', true), feature('toString', true)];
    const fetchImpl = mockFetch(new Response(JSON.stringify(body), { status: 200 }));
    expect(await fetchFlags(CONFIG, fetchImpl)).toEqual({ budget: true });
  });

  it('sends the environment key header and a trailing-slash-normalised URL', async () => {
    const fetchImpl = mockFetch(new Response('[]', { status: 200 }));
    await fetchFlags({ ...CONFIG, apiUrl: 'https://flags.example.com/api/v1//' }, fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://flags.example.com/api/v1/flags/');
    expect(init.headers).toEqual({
      'X-Environment-Key': 'ser.client-key',
      Accept: 'application/json',
    });
  });

  it('throws on a 401', async () => {
    const fetchImpl = mockFetch(new Response('{"detail":"Invalid key"}', { status: 401 }));
    await expect(fetchFlags(CONFIG, fetchImpl)).rejects.toThrow('flagsmith HTTP 401');
  });

  it('throws on a malformed body', async () => {
    const fetchImpl = mockFetch(new Response('{"not":"an array"}', { status: 200 }));
    await expect(fetchFlags(CONFIG, fetchImpl)).rejects.toThrow();
  });
});
