import { createTestDb } from '../db/testDb';
import { runSync, withSyncPaused, SYNC_WATCHDOG_MS } from './runSync';
import { enqueueOperation } from './outbox';
import { registerSyncHandler } from './syncTrigger';
import { clientFor } from '../api/ff3/session';
import { readStoredCredentials, probeAbout } from '../api/ff3/auth';
import { readHosts } from '../api/ff3/hosts';
import { readGeminiKey } from '../settings/secrets';
import { getBalancesStale, setBalancesStale } from '../settings/appSettings';
import { referenceAccounts } from '../db/schema';
import { logLine } from '../utils/log';

jest.mock('../api/ff3/session', () => ({ clientFor: jest.fn() }));
jest.mock('../api/ff3/auth', () => ({ readStoredCredentials: jest.fn(), probeAbout: jest.fn() }));
jest.mock('../api/ff3/hosts', () => ({
  ...jest.requireActual('../api/ff3/hosts'),
  readHosts: jest.fn(),
}));
jest.mock('../settings/secrets', () => ({ readGeminiKey: jest.fn(async () => null) }));
// The real log writes through expo-file-system, whose Jest mock rejects asynchronously.
jest.mock('../utils/log', () => ({ logLine: jest.fn() }));

function buildClient(opts: { failCreate?: boolean; slow?: boolean } = {}) {
  const request = jest.fn(async (path: string, init?: RequestInit) => {
    if (opts.slow) await new Promise((r) => setTimeout(r, 20));
    if (path.startsWith('/v1/transactions') && init?.method === 'POST') {
      if (opts.failCreate) throw new Error('network down');
      return {
        data: { id: 'g1', attributes: { transactions: [{ transaction_journal_id: 'j1' }] } },
      };
    }
    return { data: [] }; // accounts/categories/budgets/currencies + both GET transaction pulls
  });
  return { request };
}

function signedInWith(hosts: string[], alive: (host: string) => boolean = () => true) {
  (readStoredCredentials as jest.Mock).mockResolvedValue({ host: hosts[0], apiToken: 'tok' });
  (readHosts as jest.Mock).mockResolvedValue(hosts);
  (probeAbout as jest.Mock).mockImplementation(async (host: string) =>
    alive(host) ? { ok: true, apiVersion: '6.3.2' } : { ok: false, reason: 'invalid_host' },
  );
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

  it('gives up on a sync that never ends, so the next one starts fresh instead of joining it', async () => {
    jest.useFakeTimers();
    try {
      (readStoredCredentials as jest.Mock).mockReturnValueOnce(new Promise(() => undefined));
      (readHosts as jest.Mock).mockResolvedValue([]);
      const hung = runSync(createTestDb() as any);
      await jest.advanceTimersByTimeAsync(SYNC_WATCHDOG_MS);
      await expect(hung).resolves.toMatchObject({ error: 'timed out' });

      (readStoredCredentials as jest.Mock).mockResolvedValue(null);
      await expect(runSync(createTestDb() as any)).resolves.toMatchObject({ signedIn: false });
    } finally {
      jest.useRealTimers();
    }
  });

  it('withSyncPaused waits for a running sync, and a sync asked for meanwhile writes nothing', async () => {
    signedInWith(['https://ff3.example.com']);
    const client = buildClient({ slow: true });
    (clientFor as jest.Mock).mockReturnValue(client);
    const db = createTestDb() as any;

    const running = runSync(db);
    let requestsWhenPaused = -1;
    await withSyncPaused(async () => {
      requestsWhenPaused = client.request.mock.calls.length;
      const during = await runSync(db);
      expect(during.signedIn).toBe(false);
    });

    await running;
    // Everything the sync was going to request had been requested before the work began.
    expect(requestsWhenPaused).toBeGreaterThan(0);
    expect(client.request.mock.calls).toHaveLength(requestsWhenPaused);
    // After the pause syncing works again.
    await expect(runSync(db)).resolves.toMatchObject({ signedIn: true });
  });

  it('asks for a push after the pause when a sync was refused during it, even if the work failed', async () => {
    jest.useFakeTimers();
    const sync = jest.fn();
    const unregister = registerSyncHandler(sync);
    try {
      signedInWith(['https://ff3.example.com']);
      (clientFor as jest.Mock).mockReturnValue(buildClient());
      const db = createTestDb() as any;

      await expect(
        withSyncPaused(async () => {
          await runSync(db, 'push'); // a write asked for its push, and got nothing
          throw new Error('wrong token');
        }),
      ).rejects.toThrow('wrong token');
      expect(sync).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1_000);
      expect(sync).toHaveBeenCalledTimes(1);

      // A pause nobody asked a sync during leaves nothing to redo.
      await withSyncPaused(async () => undefined);
      jest.advanceTimersByTime(60_000);
      expect(sync).toHaveBeenCalledTimes(1);
    } finally {
      unregister();
      jest.useRealTimers();
    }
  });

  it('skips the re-pull of recent transactions when replay succeeded nothing', async () => {
    signedInWith(['https://ff3.example.com']);
    const client = buildClient();
    (clientFor as jest.Mock).mockReturnValue(client);

    const summary = await runSync(createTestDb() as any);

    expect(summary.replaySucceeded).toBe(0);
    const transactionGets = client.request.mock.calls.filter(
      ([path, init]) =>
        path.startsWith('/v1/transactions') && !path.includes('&end=') && init?.method !== 'POST',
    );
    // one from pullReferenceData's own pullRecentTransactions call — no second, conditional re-pull.
    expect(transactionGets).toHaveLength(1);
  });

  it('surfaces a mid-queue replay failure in the summary instead of throwing', async () => {
    signedInWith(['https://ff3.example.com']);
    (clientFor as jest.Mock).mockReturnValue(buildClient({ failCreate: true }));
    const db = createTestDb();
    await enqueueOperation(db, {
      id: 'op-1',
      kind: 'create_transaction',
      payload: { clientId: 'c1', splits: [] },
    });

    const summary = await runSync(db as any);

    expect(summary.failedAt).toBe('op-1');
    expect(summary.replaySucceeded).toBe(0);
    expect(summary.error).toBeNull();
  });

  it('builds its client from the address that answered this sync, not a remembered one', async () => {
    signedInWith(
      ['https://dead.example.com', 'https://alive.example.com'],
      (h) => h === 'https://alive.example.com',
    );
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
    await enqueueOperation(db, {
      id: 'op-1',
      kind: 'create_transaction',
      payload: { clientId: 'c1', splits: [] },
    });

    const summary = await runSync(db as any);

    expect(summary).toMatchObject({
      signedIn: true,
      ff3Reachable: false,
      error: null,
      lastSyncedAt: null,
    });
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

  it('keeps the stored last-synced time on a sync that does not replace it', async () => {
    signedInWith(['https://ff3.example.com']);
    (clientFor as jest.Mock).mockReturnValue(buildClient());
    const db = createTestDb();
    const first = await runSync(db as any);
    expect(first.lastSyncedAt).not.toBeNull();

    const push = await runSync(db as any, 'push');

    expect(push.lastSyncedAt).toBe(first.lastSyncedAt);
  });

  it('a second call while a sync runs joins it instead of starting another replay', async () => {
    signedInWith(['https://ff3.example.com']);
    const client = buildClient({ slow: true });
    (clientFor as jest.Mock).mockReturnValue(client);
    const db = createTestDb();
    await enqueueOperation(db, {
      id: 'op-1',
      kind: 'create_transaction',
      payload: { clientId: 'c1', splits: [] },
    });

    const [a, b] = await Promise.all([runSync(db as any), runSync(db as any)]);

    expect(a).toBe(b);
    const posts = client.request.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts).toHaveLength(1);
  });

  describe('account balances after a replay (cash count)', () => {
    async function dbWithAccount() {
      const db = createTestDb();
      await db.insert(referenceAccounts).values({
        id: 'a1',
        name: 'Wallet',
        type: 'asset',
        currencyCode: 'PLN',
        currentBalance: '100.00',
        syncedAt: '2026-01-01T00:00:00Z',
      });
      return db;
    }

    function clientWithBalance(balance: string | Error) {
      return {
        request: jest.fn(async (path: string, init?: RequestInit) => {
          if (path.startsWith('/v1/transactions') && init?.method === 'POST') {
            return {
              data: { id: 'g1', attributes: { transactions: [{ transaction_journal_id: 'j1' }] } },
            };
          }
          if (path.startsWith('/v1/accounts?type=asset')) {
            if (balance instanceof Error) throw balance;
            return {
              data: [
                {
                  id: 'a1',
                  attributes: {
                    name: 'Wallet',
                    type: 'asset',
                    currency_code: 'PLN',
                    active: true,
                    current_balance: balance,
                    current_balance_date: '2026-01-02T00:00:00Z',
                  },
                },
              ],
            };
          }
          return { data: [] };
        }),
      };
    }

    async function balanceOf(db: ReturnType<typeof createTestDb>) {
      return (await db.select().from(referenceAccounts))[0]?.currentBalance;
    }

    it('re-reads balances once a queued write lands, even on a push sync', async () => {
      signedInWith(['https://ff3.example.com']);
      (clientFor as jest.Mock).mockReturnValue(clientWithBalance('90.00'));
      const db = await dbWithAccount();
      await enqueueOperation(db, {
        id: 'op-1',
        kind: 'create_transaction',
        payload: { clientId: 'c1', splits: [] },
      });

      const summary = await runSync(db as any, 'push');

      expect(summary.replaySucceeded).toBe(1);
      expect(await balanceOf(db)).toBe('90.00');
      expect(await getBalancesStale(db as any)).toBe(false);
    });

    it('leaves balances marked stale when the re-read fails, without failing the sync', async () => {
      signedInWith(['https://ff3.example.com']);
      (clientFor as jest.Mock).mockReturnValue(clientWithBalance(new Error('network down')));
      const db = await dbWithAccount();
      await enqueueOperation(db, {
        id: 'op-1',
        kind: 'create_transaction',
        payload: { clientId: 'c1', splits: [] },
      });

      const summary = await runSync(db as any, 'push');

      expect(summary.replaySucceeded).toBe(1);
      expect(summary.error).toBeNull();
      expect(await balanceOf(db)).toBe('100.00');
      expect(await getBalancesStale(db as any)).toBe(true);
      expect(logLine).toHaveBeenCalledWith('warn', expect.stringContaining('network down'));
    });

    it('marks balances stale while a write is queued but has not landed', async () => {
      signedInWith(['https://ff3.example.com']);
      (clientFor as jest.Mock).mockReturnValue(buildClient({ failCreate: true }));
      const db = await dbWithAccount();
      await enqueueOperation(db, {
        id: 'op-1',
        kind: 'create_transaction',
        payload: { clientId: 'c1', splits: [] },
      });

      await runSync(db as any, 'push');

      expect(await getBalancesStale(db as any)).toBe(true);
    });

    it('a full sync with nothing queued clears the mark', async () => {
      signedInWith(['https://ff3.example.com']);
      (clientFor as jest.Mock).mockReturnValue(clientWithBalance('90.00'));
      const db = await dbWithAccount();
      await setBalancesStale(db as any, true);

      const summary = await runSync(db as any);

      expect(summary.error).toBeNull();
      expect(await getBalancesStale(db as any)).toBe(false);
    });
  });
});
