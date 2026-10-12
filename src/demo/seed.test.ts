import { createTestDb } from '../db/testDb';
import {
  bucketObjects,
  cachedTransactions,
  plannedObjects,
  referenceAccounts,
  referenceBudgets,
  referenceCategories,
  referenceCurrencies,
} from '../db/schema';
import { demoRows, loadDemoData, type DemoSeed } from './seed';
import seedFile from '../../tools/ff3-test/seed.json';
import { envelopesFor } from '../bucket/envelopes';
import { readBucketRow, type BucketObject } from '../bucket/objects';
import { periodOf } from '../bucket/period';
import { billsDueIn } from '../sync/bucketData';
import { readPlannedRow } from '../planned/objects';
import { getDefaultSourceAccountId } from '../settings/appSettings';

// Mid-October, noon, Warsaw (the suite's TZ): the seed's "this month" is October 2026.
const TODAY = new Date(2026, 9, 12, 12);
const seed = seedFile as DemoSeed;

describe('demoRows', () => {
  it('builds one row per entity the seed describes', () => {
    const rows = demoRows(seed, TODAY);
    expect(rows.currencies).toHaveLength(2);
    expect(rows.accounts).toHaveLength(9);
    expect(rows.categories).toHaveLength(5);
    expect(rows.budgets).toHaveLength(2);
    // 7 monthly Żabka + 7 monthly Salary + Cash withdrawal + Fuel + Weekly shop + Snacks.
    expect(rows.transactions).toHaveLength(18);
    expect(rows.planned).toHaveLength(1);
    expect(rows.buckets).toHaveLength(2);
  });

  it('marks the primary currency as the default', () => {
    const rows = demoRows(seed, TODAY);
    expect(rows.currencies.find((c) => c.isDefault)?.code).toBe('PLN');
  });

  it('expands the seeded dates relative to today, with {month} filled in', () => {
    const rows = demoRows(seed, TODAY);
    const dates = rows.transactions.map((t) => t.date.slice(0, 10));
    // monthly entries land on the 5th (Żabka) and the 1st (Salary), back to six months ago
    expect(dates).toEqual(expect.arrayContaining(['2026-10-05', '2026-04-05', '2026-10-01']));
    const zabka = rows.transactions.filter((t) => t.destinationName === 'Żabka').map((t) => t.date);
    expect(zabka.filter((d) => d?.startsWith('2026-04'))).toHaveLength(1);
    const zabkaDescriptions = rows.transactions
      .filter((t) => t.destinationName === 'Żabka' && t.sourceName === 'Checking')
      .map((t) => t.description);
    expect(zabkaDescriptions).toContain('Żabka 2026-10');
    // daysAgo is counted back from today: 2 days ago is 2026-10-10
    expect(rows.transactions.find((t) => t.description === 'Weekly shop')?.date.slice(0, 10)).toBe(
      '2026-10-10',
    );
  });

  it('stores amounts as decimal strings, a split group as its total', () => {
    const rows = demoRows(seed, TODAY);
    for (const t of rows.transactions) expect(t.amount).toMatch(/^\d+(\.\d+)?$/);
    expect(rows.transactions.find((t) => t.description === 'Weekly shop')).toMatchObject({
      amount: '52.50',
      splitCount: 2,
      // the group's budget is its first split's, as cachedRowFromGroup has always read it
      budgetName: 'Food',
    });
  });

  it('balances the asset accounts from their opening balance and the seeded splits', () => {
    const rows = demoRows(seed, TODAY);
    const balance = (name: string) => rows.accounts.find((a) => a.name === name)?.currentBalance;
    // 5000 + 7 × 6500 − 7 × 23.45 − 200 − 250 − 40 − 12.50
    expect(balance('Checking')).toBe('49833.35');
    // 300 + 200 (transfer in) − 15 (Snacks)
    expect(balance('Cash wallet')).toBe('485.00');
    expect(balance('Savings EUR')).toBe('1000.00');
    expect(rows.accounts.find((a) => a.name === 'Biedronka')?.currentBalance).toBeNull();
  });

  it("puts this month's Food withdrawals into the Food envelope, as a negative spent", () => {
    const rows = demoRows(seed, TODAY);
    const food = rows.budgets.find((b) => b.name === 'Food')!.id;
    const limit = rows.buckets.find((b) => b.kind === 'budget_limit');
    const spent = rows.buckets.find((b) => b.kind === 'budget_spent');
    // Żabka 23.45 (Oct 5) + Biedronka Food 40.00 (Oct 10); the Cleaning split has no budget
    expect(limit).toMatchObject({
      key: `budget_limit:${food}:2026-10-01`,
      periodStart: '2026-10-01',
    });
    expect(JSON.parse(limit!.attributesJson)).toMatchObject({ amount: '400.00', spent: '-63.45' });
    expect(JSON.parse(spent!.attributesJson)).toMatchObject({ spent: '-63.45' });
  });
});

describe('loadDemoData', () => {
  it('writes the rows and the readers take them back as the Budget and Planned tabs read them', async () => {
    const db = createTestDb() as any;
    await loadDemoData(db, TODAY);

    expect(await db.select().from(referenceCurrencies)).toHaveLength(2);
    expect(await db.select().from(referenceAccounts)).toHaveLength(9);
    expect(await db.select().from(referenceCategories)).toHaveLength(5);
    expect(await db.select().from(referenceBudgets)).toHaveLength(2);
    expect(await db.select().from(cachedTransactions)).toHaveLength(18);
    expect(await db.select().from(plannedObjects)).toHaveLength(1);
    expect(await db.select().from(bucketObjects)).toHaveLength(2);

    const period = periodOf('2026-10-12');
    const objects = (await db.select().from(bucketObjects)).map(readBucketRow) as BucketObject[];
    const budgets = await db.select().from(referenceBudgets);
    const food = envelopesFor(budgets, objects, period.start, 'PLN').find((e) => e.name === 'Food');
    expect(food).toMatchObject({ assigned: '400.00', spent: '-63.45', available: '336.55' });

    const planned = (await db.select().from(plannedObjects)).map(readPlannedRow);
    const due = billsDueIn((await db.select().from(plannedObjects)) as any, period);
    expect(planned[0]).toMatchObject({ kind: 'bill', name: 'Internet' });
    expect(due).toEqual([
      {
        billId: 'demo-1',
        name: 'Internet',
        amount: '79.00',
        currencyCode: 'PLN',
        date: '2026-10-10',
      },
    ]);
  });

  it("makes the demo's Checking account the default source, so Capture has one to start from", async () => {
    const db = createTestDb() as any;
    await loadDemoData(db, TODAY);

    const checking = demoRows(seed, TODAY).accounts.find((a) => a.name === 'Checking');
    expect(checking).toBeDefined();
    expect(await getDefaultSourceAccountId(db)).toBe(checking!.id);
  });
});
