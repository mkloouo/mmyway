import { createTestDb } from '../db/testDb';
import { bucketObjects } from '../db/schema';
import { periodOf } from '../bucket/period';
import { readBucketRow } from '../bucket/objects';
import { billsDueIn, pullBucketData, pulledPeriods } from './bucketData';

const TODAY = '2026-10-11';
const [OPEN, PREVIOUS] = pulledPeriods(TODAY);

/** A Firefly III that answers the five requests pullBucketData makes, keyed by window. */
function fakeFF3() {
  const limits: Record<string, unknown[]> = {
    [OPEN.start]: [
      {
        id: '11',
        attributes: {
          budget_id: '1',
          amount: '800.00',
          spent: '-320.50',
          currency_code: 'PLN',
          start: `${OPEN.start}T00:00:00+02:00`,
          end: `${OPEN.end}T23:59:59+02:00`,
        },
      },
      // A limit that only partly overlaps the window: FF3's repository can hand it back, and
      // reading it as this period's would show an assignment nobody made.
      {
        id: '99',
        attributes: { budget_id: '2', amount: '50.00', start: '2026-10-15', end: '2026-11-14' },
      },
    ],
    [PREVIOUS.start]: [
      {
        id: '10',
        attributes: {
          budget_id: '1',
          amount: '700.00',
          spent: '-690.00',
          currency_code: 'PLN',
          start: PREVIOUS.start,
          end: PREVIOUS.end,
        },
      },
    ],
  };
  const budgets = [
    {
      id: '1',
      attributes: { name: 'Groceries', spent: [{ sum: '-320.50', currency_code: 'PLN' }] },
    },
    {
      id: '2',
      attributes: { name: 'Dining Out', spent: [{ sum: '-45.00', currency_code: 'PLN' }] },
    },
    { id: '3', attributes: { name: 'Untouched', spent: [] } },
  ];
  const request = jest.fn(async (path: string): Promise<unknown> => {
    const start = /start=(\d{4}-\d{2}-\d{2})/.exec(path)?.[1] ?? '';
    if (path.startsWith('/v1/budget-limits')) return { data: limits[start] ?? [] };
    if (path.startsWith('/v1/budgets')) return { data: budgets };
    if (path.startsWith('/v1/piggy-banks'))
      return {
        data: [
          {
            id: '7',
            attributes: {
              name: 'New laptop',
              current_amount: '300.00',
              target_amount: '4000.00',
              accounts: [{ id: '5', name: 'Revolut', current_amount: '300.00' }],
            },
          },
        ],
      };
    throw new Error(`no handler for ${path}`);
  });
  return { request };
}

async function pull() {
  const db = createTestDb();
  const client = fakeFF3();
  await pullBucketData(db as never, client as never, TODAY);
  const rows = await db.select().from(bucketObjects);
  return { db, client, rows: rows.map(readBucketRow) };
}

describe('pullBucketData', () => {
  it('caches a limit under the period start it belongs to', async () => {
    const { rows } = await pull();
    const limits = rows.filter((r) => r?.kind === 'budget_limit');
    expect(limits.map((l) => [l!.ff3Id, l!.periodStart, l!.attributes.amount])).toEqual(
      expect.arrayContaining([
        ['1', OPEN.start, '800.00'],
        ['1', PREVIOUS.start, '700.00'],
      ]),
    );
    // The limit's own id is folded into the attributes, so an assignment can PUT it.
    expect(limits.find((l) => l!.periodStart === OPEN.start)!.attributes.id).toBe('11');
  });

  it('drops a limit that only partly overlaps the window', async () => {
    const { rows } = await pull();
    expect(rows.some((r) => r?.kind === 'budget_limit' && r.ff3Id === '2')).toBe(false);
  });

  it('keeps unbudgeted spending visible for a budget with no limit', async () => {
    const { rows } = await pull();
    const unbudgeted = rows.find((r) => r?.kind === 'budget_spent' && r.ff3Id === '2');
    expect(unbudgeted!.attributes).toMatchObject({ spent: '-45.00', currency_code: 'PLN' });
    // Nothing spent and nothing assigned is not a row: the budget still lists from reference_budgets.
    expect(rows.some((r) => r?.ff3Id === '3')).toBe(false);
  });

  it('reads the two windows as separate requests, so each gets its own spent', async () => {
    const { client } = await pull();
    const windows = client.request.mock.calls
      .map(([path]) => path)
      .filter((path) => path.startsWith('/v1/budget-limits'))
      .map((path) => /start=(\d{4}-\d{2}-\d{2})/.exec(path)?.[1]);
    expect(new Set(windows)).toEqual(new Set([OPEN.start, PREVIOUS.start]));
  });

  it('caches piggy banks with no period of their own', async () => {
    const { rows } = await pull();
    const piggy = rows.find((r) => r?.kind === 'piggy');
    expect(piggy).toMatchObject({ ff3Id: '7', periodStart: null });
    expect(piggy!.attributes.current_amount).toBe('300.00');
  });

  it('replaces the cache wholesale rather than leaving stale rows behind', async () => {
    const { db, rows } = await pull();
    const before = rows.length;
    await pullBucketData(db as never, fakeFF3() as never, TODAY);
    expect((await db.select().from(bucketObjects)).length).toBe(before);
  });
});

describe('billsDueIn', () => {
  function bill(name: string, attributes: Record<string, unknown>) {
    return {
      key: `bill:${name}`,
      kind: 'bill' as const,
      ff3Id: name,
      name,
      attributesJson: JSON.stringify({ name, ...attributes }),
      syncedAt: 's',
    };
  }

  it('counts an active bill Firefly III expects to be paid in the period', () => {
    expect(
      billsDueIn(
        [
          bill('Rent', {
            amount_max: '2500.00',
            currency_code: 'PLN',
            next_expected_match: `${OPEN.start}T00:00:00+02:00`,
          }),
        ],
        OPEN,
      ),
    ).toEqual([
      { billId: 'Rent', name: 'Rent', amount: '2500.00', currencyCode: 'PLN', date: OPEN.start },
    ]);
  });

  it('leaves out a bill due in another period, an inactive one, and one with no amount', () => {
    const rows = [
      bill('Next month', { amount_max: '10.00', next_expected_match: '2026-11-03' }),
      bill('Switched off', {
        amount_max: '10.00',
        active: false,
        next_expected_match: OPEN.start,
      }),
      bill('No amount', { next_expected_match: OPEN.start }),
      // Already paid this period: FF3 has moved next_expected_match on to the next one.
      bill('Paid', { amount_max: '10.00', next_expected_match: '2026-11-01' }),
    ];
    expect(billsDueIn(rows, OPEN)).toEqual([]);
  });

  it('falls back to amount_min and sorts by date', () => {
    const rows = [
      bill('Later', { amount_max: '5.00', next_expected_match: `${OPEN.start.slice(0, 8)}20` }),
      bill('Earlier', { amount_min: '7.00', next_expected_match: OPEN.start }),
    ];
    expect(billsDueIn(rows, OPEN).map((b) => [b.name, b.amount])).toEqual([
      ['Earlier', '7.00'],
      ['Later', '5.00'],
    ]);
  });

  it('ignores rows of other planned kinds', () => {
    const rule = { ...bill('A rule', { amount_max: '5.00', next_expected_match: OPEN.start }) };
    expect(billsDueIn([{ ...rule, kind: 'rule' as never }], OPEN)).toEqual([]);
  });
});

describe('pulledPeriods', () => {
  it('is the open month and the one before it', () => {
    expect(pulledPeriods('2026-01-05')).toEqual([periodOf('2026-01-05'), periodOf('2025-12-05')]);
  });
});
