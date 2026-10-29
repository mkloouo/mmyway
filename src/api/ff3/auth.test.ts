import { probeAbout } from './auth';
import { setProxyHeadersForTest } from './proxyHeaders';

function mockFetchOnce(status: number, body: unknown, contentType = 'application/json') {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null),
    },
    json: async () => body,
  }) as unknown as typeof fetch;
}

describe('probeAbout', () => {
  afterEach(() => {
    setProxyHeadersForTest({});
    jest.useRealTimers();
  });

  it('includes configured proxy credentials on the sign-in and reachability probe', async () => {
    setProxyHeadersForTest({
      'CF-Access-Client-Id': 'proxy-id',
      'CF-Access-Client-Secret': 'proxy-secret',
    });
    mockFetchOnce(200, { data: { api_version: '6.7.0' } });
    await probeAbout('https://ff3.example.com', 'token');
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token',
          'CF-Access-Client-Id': 'proxy-id',
          'CF-Access-Client-Secret': 'proxy-secret',
        }),
      }),
    );
  });

  it('keeps the timeout active until the response body finishes', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(async (_url, init) => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    })) as unknown as typeof fetch;
    const result = probeAbout('https://ff3.example.com', 'token', 100);
    await jest.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toEqual({ ok: false, reason: 'invalid_host' });
  });

  it('accepts a modern version', async () => {
    mockFetchOnce(200, { data: { version: '6.7.0', api_version: '6.7.0' } });
    const result = await probeAbout('https://ff3.example.com', 'token');
    expect(result).toEqual({ ok: true, apiVersion: '6.7.0' });
  });

  it('treats a develop/ version as high enough', async () => {
    mockFetchOnce(200, { data: { version: 'develop', api_version: 'develop/abcdef' } });
    const result = await probeAbout('https://ff3.example.com', 'token');
    expect(result.ok).toBe(true);
  });

  it('rejects a too-low version', async () => {
    mockFetchOnce(200, { data: { version: '5.0.0', api_version: '5.0.0' } });
    const result = await probeAbout('https://ff3.example.com', 'token');
    expect(result).toEqual({ ok: false, reason: 'api_version_too_low' });
  });

  it('rejects the releases whose recurrence update validates `moment` as a number', async () => {
    // 6.1.25 → 6.6.x read `repetitions.*.moment` as numeric, which no yearly moment (a date) and
    // no monthly one past the 10th can satisfy. 6.7.0 fixed it, and the Planned tab's schedule
    // editor sends both — so those releases are below the floor, not merely limited.
    for (const version of ['6.3.2', '6.6.0', '6.6.9']) {
      mockFetchOnce(200, { data: { version, api_version: version } });
      expect(await probeAbout('https://ff3.example.com', 'token')).toEqual({
        ok: false,
        reason: 'api_version_too_low',
      });
    }
    for (const version of ['6.7.0', '6.7.7', '6.8.0', '7.0.0']) {
      mockFetchOnce(200, { data: { version, api_version: version } });
      expect((await probeAbout('https://ff3.example.com', 'token')).ok).toBe(true);
    }
  });

  it('flags a 401 as an invalid api key', async () => {
    mockFetchOnce(401, {});
    const result = await probeAbout('https://ff3.example.com', 'token');
    expect(result).toEqual({ ok: false, reason: 'invalid_api_key' });
  });

  it('flags an HTML response (login redirect) as an invalid api key', async () => {
    mockFetchOnce(200, '<html></html>', 'text/html');
    const result = await probeAbout('https://ff3.example.com', 'token');
    expect(result).toEqual({ ok: false, reason: 'invalid_api_key' });
  });
});
