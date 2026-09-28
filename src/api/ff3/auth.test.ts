import { probeAbout } from './auth';

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
  it('accepts a modern version', async () => {
    mockFetchOnce(200, { data: { version: '6.3.2', api_version: '6.3.2' } });
    const result = await probeAbout('https://ff3.example.com', 'token');
    expect(result).toEqual({ ok: true, apiVersion: '6.3.2' });
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
