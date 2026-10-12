import { createTestDb } from '../db/testDb';
import { buildChain } from './buildChain';
import { runProviderChain } from './chain';
import { setLocalModelBaseUrl, setLocalModelName, setReceiptReader } from '../settings/appSettings';
import { readGeminiKey } from '../settings/secrets';

jest.mock('../settings/secrets', () => ({ readGeminiKey: jest.fn() }));

const LOCAL_URL = 'http://localhost:1234';
const GEMINI_HOST = 'generativelanguage.googleapis.com';

describe('buildChain', () => {
  it('returns an empty chain when neither provider is configured', async () => {
    (readGeminiKey as jest.Mock).mockResolvedValue(null);
    const db = createTestDb();
    expect(await buildChain(db as any)).toEqual([]);
  });

  it('orders local before gemini when both are configured', async () => {
    (readGeminiKey as jest.Mock).mockResolvedValue('key-123');
    const db = createTestDb();
    await setLocalModelBaseUrl(db as any, 'http://localhost:1234');
    await setLocalModelName(db as any, 'llava');

    const chain = await buildChain(db as any);
    expect(chain.map((p) => p.name)).toEqual(['Local model', 'Gemini']);
  });

  it('skips the local provider when its base URL is not configured', async () => {
    (readGeminiKey as jest.Mock).mockResolvedValue('key-123');
    const db = createTestDb();
    const chain = await buildChain(db as any);
    expect(chain.map((p) => p.name)).toEqual(['Gemini']);
  });
});

describe('buildChain by receipt reader', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  /** Every request fails as if the network were down, so the chain tries each reader in turn. */
  function offlineFetch() {
    const fetchMock = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }
  const askedUrls = (fetchMock: jest.Mock) => fetchMock.mock.calls.map(([url]) => String(url));
  const input = { imageBase64: 'aGk=', categoryNames: [] };

  async function configuredDb() {
    (readGeminiKey as jest.Mock).mockResolvedValue('key-123');
    const db = createTestDb();
    await setLocalModelBaseUrl(db as any, LOCAL_URL);
    await setLocalModelName(db as any, 'llava');
    return db;
  }

  it("'none' builds an empty chain and makes no request, even with both configured", async () => {
    const db = await configuredDb();
    await setReceiptReader(db as any, 'none');
    const fetchMock = offlineFetch();

    expect(await buildChain(db as any)).toEqual([]);
    const outcome = await runProviderChain(await buildChain(db as any), input);
    expect(outcome.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("'local' keeps only the local model, and Gemini is never asked", async () => {
    const db = await configuredDb();
    await setReceiptReader(db as any, 'local');
    const fetchMock = offlineFetch();

    const chain = await buildChain(db as any);
    expect(chain.map((p) => p.name)).toEqual(['Local model']);
    await runProviderChain(chain, input);
    expect(askedUrls(fetchMock)).toEqual([`${LOCAL_URL}/v1/chat/completions`]);
    expect(askedUrls(fetchMock).join(' ')).not.toContain(GEMINI_HOST);
  });

  it("'auto' asks the local model first, then Gemini", async () => {
    const db = await configuredDb();
    await setReceiptReader(db as any, 'auto');
    const fetchMock = offlineFetch();

    const chain = await buildChain(db as any);
    expect(chain.map((p) => p.name)).toEqual(['Local model', 'Gemini']);
    await runProviderChain(chain, input);
    expect(askedUrls(fetchMock)).toEqual([
      `${LOCAL_URL}/v1/chat/completions`,
      expect.stringContaining(GEMINI_HOST),
    ]);
  });
});
