import { createFF3Client, REQUEST_TIMEOUT_MS } from './client';
import { serverUnavailable } from '../../sync/outbox';

const client = createFF3Client({ baseUrl: 'https://ff3.example.com', apiToken: 'tok' });

function hangingFetch() {
  return jest.fn(
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  );
}

describe('createFF3Client request timeout', () => {
  const realFetch = global.fetch;
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    global.fetch = realFetch;
  });

  it('aborts a request that never gets an answer, as something serverUnavailable() recognises', async () => {
    global.fetch = hangingFetch() as any;
    const result = client.request('/v1/about').catch((e) => e);
    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    const err = await result;
    expect(err).toMatchObject({ name: 'AbortError' });
    expect(serverUnavailable(err)).toBe(true);
  });

  it('honours a longer timeoutMs', async () => {
    global.fetch = hangingFetch() as any;
    const result = client.request('/v1/x', { timeoutMs: 60_000 }).catch((e) => e);
    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1);
    let settled = false;
    void result.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(await result).toMatchObject({ name: 'AbortError' });
  });

  it("aborts with the caller's own signal", async () => {
    global.fetch = hangingFetch() as any;
    const caller = new AbortController();
    const result = client.request('/v1/x', { signal: caller.signal }).catch((e) => e);
    caller.abort();
    expect(await result).toMatchObject({ name: 'AbortError' });
  });

  it('returns the body of a request that answers in time', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: 1 }),
    })) as any;
    await expect(client.request('/v1/x')).resolves.toEqual({ ok: 1 });
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('createFF3Client Content-Type', () => {
  it('sends Content-Type on a bodyless POST, like recurrences/{id}/trigger', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, status: 204 })) as any;
    global.fetch = fetchMock;
    await client.request('/v1/recurrences/15/trigger', { method: 'POST' });
    expect(fetchMock.mock.calls[0][1].headers['Content-Type']).toBe('application/vnd.api+json');
  });

  it('omits Content-Type on a GET', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    })) as any;
    global.fetch = fetchMock;
    await client.request('/v1/about');
    expect(fetchMock.mock.calls[0][1].headers['Content-Type']).toBeUndefined();
  });
});
