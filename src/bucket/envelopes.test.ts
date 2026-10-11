import { envelopeHeadroom, envelopesFor, spentAmount } from './envelopes';
import { bucketKey, type BucketObject } from './objects';

const PERIOD = '2026-10-01';

const budgets = [
  { id: '1', name: 'Groceries', active: true },
  { id: '2', name: 'Dining Out', active: true },
  { id: '3', name: 'Archived', active: false },
];

function limit(budgetId: string, amount: string, spent: string, id = `l${budgetId}`): BucketObject {
  return {
    key: bucketKey('budget_limit', budgetId, PERIOD),
    kind: 'budget_limit',
    ff3Id: budgetId,
    periodStart: PERIOD,
    attributes: { id, amount, spent, currency_code: 'PLN', start: PERIOD, end: '2026-10-31' },
  };
}

function unbudgeted(budgetId: string, spent: string): BucketObject {
  return {
    key: bucketKey('budget_spent', budgetId, PERIOD),
    kind: 'budget_spent',
    ff3Id: budgetId,
    periodStart: PERIOD,
    attributes: { spent, currency_code: 'PLN' },
  };
}

describe('envelopesFor', () => {
  it('adds the negative spent to the limit amount to get what is left', () => {
    const [dining, groceries] = envelopesFor(
      budgets,
      [limit('1', '800.00', '-320.50')],
      PERIOD,
      'PLN',
    );
    // Sorted by name: Dining Out before Groceries.
    expect(dining).toMatchObject({ name: 'Dining Out', limitId: null, assigned: '0' });
    expect(groceries).toMatchObject({
      name: 'Groceries',
      limitId: 'l1',
      assigned: '800.00',
      spent: '-320.50',
      available: '479.50',
      overspent: false,
      currencyCode: 'PLN',
    });
  });

  it('shows spending on a budget with no limit as unbudgeted, not as zero', () => {
    const groceries = envelopesFor(budgets, [unbudgeted('1', '-120.00')], PERIOD, 'PLN').find(
      (e) => e.budgetId === '1',
    )!;
    expect(groceries).toMatchObject({
      limitId: null,
      assigned: '0',
      spent: '-120.00',
      available: '-120.00',
      overspent: true,
    });
  });

  it('marks an envelope spent past its limit as overspent', () => {
    const over = envelopesFor(budgets, [limit('2', '200.00', '-245.00')], PERIOD, 'PLN').find(
      (e) => e.budgetId === '2',
    )!;
    expect(over.available).toBe('-45.00');
    expect(over.overspent).toBe(true);
    expect(envelopeHeadroom(over)).toBe('0');
  });

  it('leaves inactive budgets out and ignores a limit from another period', () => {
    const envelopes = envelopesFor(budgets, [limit('1', '800.00', '0')], '2026-09-01', 'PLN');
    expect(envelopes.map((e) => e.name)).toEqual(['Dining Out', 'Groceries']);
    expect(envelopes.every((e) => e.assigned === '0')).toBe(true);
  });

  it('falls back to the default currency when nothing is cached for the budget', () => {
    expect(envelopesFor(budgets, [], PERIOD, 'EUR')[0]!.currencyCode).toBe('EUR');
  });
});

describe('spentAmount', () => {
  it('reads a string from a limit and a per-currency array from a budget alike', () => {
    expect(spentAmount('-12.50')).toBe('-12.50');
    expect(spentAmount([{ sum: '-10.00' }, { sum: '-2.50' }])).toBe('-12.50');
    expect(spentAmount(undefined)).toBe('0');
    expect(spentAmount([])).toBe('0');
  });
});
