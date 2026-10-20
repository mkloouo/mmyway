import * as SecureStore from 'expo-secure-store';
import { createFF3Client } from './client';
import {
  proxyHeaderProblem,
  sanitizeProxyHeaders,
  setProxyHeadersForTest,
  currentProxyHeaders,
  loadProxyHeaders,
} from './proxyHeaders';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const getItemAsync = SecureStore.getItemAsync as jest.Mock;

describe('loadProxyHeaders', () => {
  it('loads valid headers from SecureStore', async () => {
    getItemAsync.mockResolvedValueOnce(JSON.stringify({ 'CF-Access-Client-Id': 'id123' }));
    const headers = await loadProxyHeaders();
    expect(headers).toEqual({ 'CF-Access-Client-Id': 'id123' });
  });

  it('handles malformed JSON and returns empty object', async () => {
    getItemAsync.mockResolvedValueOnce('{bad json');
    const headers = await loadProxyHeaders();
    expect(headers).toEqual({});
  });

  it('handles non-string map JSON and returns empty object', async () => {
    getItemAsync.mockResolvedValueOnce(JSON.stringify(['an', 'array']));
    const headers = await loadProxyHeaders();
    expect(headers).toEqual({});
  });
});

describe('proxyHeaderProblem', () => {
  it('accepts the Cloudflare Access pair this exists for', () => {
    expect(proxyHeaderProblem('CF-Access-Client-Id', 'abc.access')).toBeNull();
    expect(proxyHeaderProblem('CF-Access-Client-Secret', 's3cret')).toBeNull();
  });

  it('refuses a header the client sets itself, whatever the casing', () => {
    expect(proxyHeaderProblem('Authorization', 'Bearer other')).toBe('reserved');
    expect(proxyHeaderProblem('authorization', 'Bearer other')).toBe('reserved');
    expect(proxyHeaderProblem('ACCEPT', 'text/html')).toBe('reserved');
    expect(proxyHeaderProblem('Content-Type', 'text/plain')).toBe('reserved');
  });

  it('refuses a name that is not an HTTP token', () => {
    expect(proxyHeaderProblem('has space', 'v')).toBe('name');
    expect(proxyHeaderProblem('has:colon', 'v')).toBe('name');
    expect(proxyHeaderProblem('', 'v')).toBe('name');
  });

  it('refuses a value that is empty or could inject a second header', () => {
    expect(proxyHeaderProblem('X-Tok', '')).toBe('value');
    expect(proxyHeaderProblem('X-Tok', '   ')).toBe('value');
    expect(proxyHeaderProblem('X-Tok', 'a\r\nX-Evil: 1')).toBe('value');
    expect(proxyHeaderProblem('X-Tok', 'a\nb')).toBe('value');
  });
});

describe('sanitizeProxyHeaders', () => {
  it('drops every unusable pair and keeps the rest', () => {
    expect(
      sanitizeProxyHeaders({
        'CF-Access-Client-Id': 'keep',
        Authorization: 'drop',
        'bad name': 'drop',
        'X-Empty': '',
        'X-Num': 7,
      }),
    ).toEqual({ 'CF-Access-Client-Id': 'keep' });
  });

  it('is total: anything that is not a string map becomes no headers', () => {
    for (const raw of [null, undefined, 'str', 42, ['a'], true])
      expect(sanitizeProxyHeaders(raw)).toEqual({});
  });
});

describe('the client sends them', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    setProxyHeadersForTest({});
  });

  it('merges the stored headers into a request without losing its own', async () => {
    setProxyHeadersForTest({ 'CF-Access-Client-Id': 'id', 'CF-Access-Client-Secret': 'sec' });
    const fetchMock = jest.fn(async () => ({ ok: true, status: 204 })) as any;
    global.fetch = fetchMock;
    const client = createFF3Client({ baseUrl: 'https://ff3.example.com', apiToken: 'tok' });

    await client.request('/v1/recurrences/15/trigger', { method: 'POST' });

    const sent = fetchMock.mock.calls[0][1].headers;
    expect(sent['CF-Access-Client-Id']).toBe('id');
    expect(sent['CF-Access-Client-Secret']).toBe('sec');
    expect(sent.Authorization).toBe('Bearer tok');
    expect(sent['Content-Type']).toBe('application/vnd.api+json');
  });

  it('puts them on imageSource too, or receipt thumbnails 403 behind the proxy', () => {
    setProxyHeadersForTest({ 'CF-Access-Client-Id': 'id' });
    const client = createFF3Client({ baseUrl: 'https://ff3.example.com', apiToken: 'tok' });
    expect(client.imageSource!('/v1/attachments/3/download').headers).toMatchObject({
      Authorization: 'Bearer tok',
      'CF-Access-Client-Id': 'id',
    });
  });

  it('sends nothing extra when none are stored', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, status: 204 })) as any;
    global.fetch = fetchMock;
    const client = createFF3Client({ baseUrl: 'https://ff3.example.com', apiToken: 'tok' });

    await client.request('/v1/about');

    expect(Object.keys(fetchMock.mock.calls[0][1].headers).sort()).toEqual([
      'Accept',
      'Authorization',
    ]);
    expect(currentProxyHeaders()).toEqual({});
  });
});
