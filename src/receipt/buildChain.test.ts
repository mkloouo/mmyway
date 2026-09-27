import { createTestDb } from '../db/testDb';
import { buildChain } from './buildChain';
import { setLocalModelBaseUrl, setLocalModelName } from '../settings/appSettings';
import { readGeminiKey } from '../settings/secrets';

jest.mock('../settings/secrets', () => ({ readGeminiKey: jest.fn() }));

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
    expect(chain.map((p) => p.name)).toEqual(['local', 'gemini']);
  });

  it('skips the local provider when its base URL is not configured', async () => {
    (readGeminiKey as jest.Mock).mockResolvedValue('key-123');
    const db = createTestDb();
    const chain = await buildChain(db as any);
    expect(chain.map((p) => p.name)).toEqual(['gemini']);
  });
});
