import { createTestDb } from '../db/testDb';
import { runSync } from './runSync';
import { enqueueOperation } from './outbox';
import { clientFor } from '../api/ff3/session';
import { readStoredCredentials, probeAbout } from '../api/ff3/auth';
import { readHosts } from '../api/ff3/hosts';
import { readGeminiKey } from '../settings/secrets';

jest.mock('../api/ff3/session', () => ({ clientFor: jest.fn() }));
jest.mock('../api/ff3/auth', () => ({ readStoredCredentials: jest.fn(), probeAbout: jest.fn() }));
jest.mock('../api/ff3/hosts', () => ({ ...jest.requireActual('../api/ff3/hosts'), readHosts: jest.fn() }));
jest.mock('../settings/secrets', () => ({ readGeminiKey: jest.fn(async () => null) }));

function buildClient(opts: { failCreate?: boolean; slow?: boolean } = {}) {
  const request = jest.fn(async (path: string, init?: RequestInit) => {
    if (opts.slow) await new Promise((r) => setTimeout(r, 20));
    if (path.startsWith('/v1/transactions') && init?.method === 'POST') {
      if (opts.failCreate) throw new Error('network down');
      return { data: { id: 'g1', attributes: { transactions: [{ transaction_journal_id: 'j1' }] } } };
    }
    return { data: [] }; // accounts/categories/budgets/currencies + both GET transaction pulls
  });
  return { request };
}

function signedInWith(hosts: string[], alive: (host: string) => boolean = () => true) {
  (readStoredCredentials as jest.Mock).mockResolvedValue({ host: hosts[0], apiToken: 'tok' });
  (readHosts as jest.Mock).mockResolvedValue(hosts);
  (probeAbout as jest.Mock).mockImplementation(async (host: string) => (
    alive(host) ? { ok: true, apiVersion: '6.3.2' } : { ok: false, reason: 'invalid_host' }
  ));
}

describe('runSync', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns a not-signed-in summary without probing anything when no credentials are stored', async () => {
    (readStoredCredentials as jest.Mock).mockResolvedValue(null);
    (readHosts as jest.Mock).mockResolvedValue([]);
    const summary = await runSync(createTestDb() as any);
    expect(summary).toMatchObject({ signedIn: false, ff3Reachable: false, replaySucceeded: 0 });
    expect(probeAbout).not.toHaveBeenCalled();
  });

  it('skips the re-pull of recent transactions when replay succeeded nothing', async () => {
    signedInWith(['https://ff3.example.com']);
    const client = buildClient();
    (clientFor as jest.Mock).mockReturnValue(client);

    const summary = await runSync(createTestDb() as any);

    expect(summary.replaySucceeded).toBe(0);
    const transactionGets = client.request.mock.calls.filter(
      ([path, init]) => path.startsWith('/v1/transactions') && init?.method !== 'POST',
    );
    // one from pullReferenceData's own pullRecentTransactions call — no second, conditional re-pull.
    expect(transactionGets).toHaveLength(1);
  });

  it('surfaces a mid-queue replay failure in the summary instead of throwing', async () => {
    signedInWith(['https://ff3.example.com']);
    (clientFor as jest.Mock).mockReturnValue(buildClient({ failCreate: true }));
    const db = createTestDb();
    await enqueueOperation(db, { id: 'op-1', kind: 'create_transaction', payload: { clientId: 'c1', splits: [] } });

    const summary = await runSync(db as any);

    expect(summary.failedAt).toBe('op-1');
    expect(summary.replaySucceeded).toBe(0);
    expect(summary.error).toBeNull();
  });

  it('builds its client from the address that answered this sync, not a remembered one', async () => {
    signedInWith(['https://dead.example.com', 'https://alive.example.com'], (h) => h === 'https://alive.example.com');
    (clientFor as jest.Mock).mockReturnValue(buildClient());

    const summary = await runSync(createTestDb() as any);

    expect(summary.ff3Reachable).toBe(true);
    expect(summary.ff3.winner).toBe('https://alive.example.com');
    expect(clientFor).toHaveBeenCalledWith('https://alive.example.com', 'tok');
    expect(summary.error).toBeNull();
  });

  it('offline is signed in and unreachable, not "not signed in", and sends nothing', async () => {
    signedInWith(['https://ff3.example.com'], () => false);
    const db = createTestDb();
    await enqueueOperation(db, { id: 'op-1', kind: 'create_transaction', payload: { clientId: 'c1', splits: [] } });

    const summary = await runSync(db as any);

    expect(summary).toMatchObject({ signedIn: true, ff3Reachable: false, error: null, lastSyncedAt: null });
    expect(clientFor).not.toHaveBeenCalled();
  });

  it('lists Gemini as a configured receipt provider though it has no address to probe', async () => {
    signedInWith(['https://ff3.example.com']);
    (clientFor as jest.Mock).mockReturnValue(buildClient());
    (readGeminiKey as jest.Mock).mockResolvedValueOnce('key');

    const summary = await runSync(createTestDb() as any);

    expect(summary.configuredProviders).toEqual(['gemini']);
    expect(summary.providers).toEqual({});
  });

  it('a second call while a sync runs joins it instead of starting another replay', async () => {
    signedInWith(['https://ff3.example.com']);
    const client = buildClient({ slow: true });
    (clientFor as jest.Mock).mockReturnValue(client);
    const db = createTestDb();
    await enqueueOperation(db, { id: 'op-1', kind: 'create_transaction', payload: { clientId: 'c1', splits: [] } });

    const [a, b] = await Promise.all([runSync(db as any), runSync(db as any)]);

    expect(a).toBe(b);
    const posts = client.request.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts).toHaveLength(1);
  });
});
