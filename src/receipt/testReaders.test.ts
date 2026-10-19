import { testReaders } from './testReaders';
import { createTestDb } from '../db/testDb';
import { setLocalModelBaseUrls, setLocalModelName } from '../settings/appSettings';
import { readGeminiKey } from '../settings/secrets';

jest.mock('../settings/secrets', () => ({
  readGeminiKey: jest.fn(),
}));

let mockDb: ReturnType<typeof createTestDb>;

beforeEach(() => {
  jest.clearAllMocks();
  mockDb = createTestDb();
  (readGeminiKey as jest.Mock).mockResolvedValue(null);
  global.fetch = jest.fn() as jest.Mock;
});

describe('testReaders', () => {
  it('returns not_configured when neither reader is set up', async () => {
    const res = await testReaders(mockDb);
    expect(res.local).toEqual({ status: 'not_configured' });
    expect(res.gemini).toEqual({ status: 'not_configured' });
  });

  it('runs local model and measures elapsed time on success', async () => {
    await setLocalModelBaseUrls(mockDb, ['http://192.168.1.50:8000']);
    await setLocalModelName(mockDb, 'qwen3-vl-8b');

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({ amount: '12.50', payee: 'Store', date: '2026-10-18' }),
            },
          },
        ],
      }),
    });

    const res = await testReaders(mockDb);
    expect(res.local.status).toBe('ok');
    if (res.local.status === 'ok') {
      expect(Number(res.local.seconds)).toBeGreaterThanOrEqual(0);
    }
  });

  it('classifies key rejected error on Gemini HTTP 400', async () => {
    (readGeminiKey as jest.Mock).mockResolvedValue('bad-key');

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'API key not valid' } }),
    });

    const res = await testReaders(mockDb);
    expect(res.gemini).toEqual({
      status: 'error',
      messageKey: 'testKeyRejected',
      raw: 'gemini provider HTTP 400',
    });
  });

  it('classifies unreachable error on network error', async () => {
    await setLocalModelBaseUrls(mockDb, ['http://192.168.1.50:8000']);
    await setLocalModelName(mockDb, 'qwen3-vl-8b');

    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network request failed'));

    const res = await testReaders(mockDb);
    expect(res.local).toEqual({
      status: 'error',
      messageKey: 'testUnreachable',
      raw: 'Network request failed',
    });
  });
});
