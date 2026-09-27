import { createTestDb } from '../db/testDb';
import { runSync } from './runSync';
import { enqueueOperation } from './outbox';
import { getClient } from '../api/ff3/session';
import { readStoredCredentials, probeAbout } from '../api/ff3/auth';
import { readHosts } from '../api/ff3/hosts';

jest.mock('../api/ff3/session', () => ({ getClient: jest.fn() }));
jest.mock('../api/ff3/auth', () => ({ readStoredCredentials: jest.fn(), probeAbout: jest.fn() }));
jest.mock('../api/ff3/hosts', () => ({ ...jest.requireActual('../api/ff3/hosts'), readHosts: jest.fn() }));

function buildClient(opts: { failCreate?: boolean } = {}) {
  const request = jest.fn(async (path: string, init?: RequestInit) => {
    if (path.startsWith('/v1/transactions') && init?.method === 'POST') {
      if (opts.failCreate) throw new Error('network down');
      return {};
    }
    return { data: [] }; // accounts/categories/budgets/currencies + both GET transaction pulls
  });
  return { request };
}

describe('runSync', () => {
  it('returns a not-signed-in summary without calling fetch when no credentials are stored', async () => {
    (getClient as jest.Mock).mockResolvedValue(null);
    global.fetch = jest.fn();
    const db = createTestDb();

    const summary = await runSync(db as any);

    expect(summary).toMatchObject({ signedIn: false, ff3Reachable: false, replaySucceeded: 0 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('skips the re-pull of recent transactions when replay succeeded nothing', async () => {
    const client = buildClient();
    (getClient as jest.Mock).mockResolvedValue(client);
    const db = createTestDb();

    const summary = await runSync(db as any);

    expect(summary.replaySucceeded).toBe(0);
    const transactionGets = client.request.mock.calls.filter(
      ([path, init]) => path.startsWith('/v1/transactions') && init?.method !== 'POST',
    );
    // one from pullReferenceData's own pullRecentTransactions call — no second call, which
    // would be the conditional re-pull this test asserts gets skipped. pullUnreviewedRecurring
    // hits /v1/tags/recurring/transactions instead, so it doesn't count toward this.
    expect(transactionGets).toHaveLength(1);
  });

  it('surfaces a mid-queue replay failure in the summary instead of throwing', async () => {
    const client = buildClient({ failCreate: true });
    (getClient as jest.Mock).mockResolvedValue(client);
    const db = createTestDb();
    await enqueueOperation(db, { id: 'op-1', kind: 'create_transaction', payload: { clientId: 'c1', splits: [] } });

    const summary = await runSync(db as any);

    expect(summary.failedAt).toBe('op-1');
    expect(summary.replaySucceeded).toBe(0);
  });

  it('a sync with two configured FF3 addresses, the first dead, still syncs via the second', async () => {
    const client = buildClient();
    (getClient as jest.Mock).mockResolvedValue(client);
    (readStoredCredentials as jest.Mock).mockResolvedValue({ host: 'https://dead.example.com', apiToken: 'tok' });
    (readHosts as jest.Mock).mockResolvedValue(['https://dead.example.com', 'https://alive.example.com']);
    (probeAbout as jest.Mock).mockImplementation(async (host: string) => (
      host === 'https://alive.example.com' ? { ok: true, apiVersion: '6.3.2' } : { ok: false, reason: 'invalid_host' }
    ));
    const db = createTestDb();

    const summary = await runSync(db as any);

    expect(summary.ff3Reachable).toBe(true);
    expect(summary.ff3.winner).toBe('https://alive.example.com');
    expect(summary.error).toBeNull();
  });
});
