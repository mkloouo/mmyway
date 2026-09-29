import { computeSweep, driftByCurrency, type SweepRow } from './sweep';

function row(overrides: Partial<SweepRow> & Pick<SweepRow, 'accountId'>): SweepRow {
  return { currencyCode: 'PLN', expected: '340.00', counted: '', ...overrides };
}

describe('computeSweep', () => {
  it('a short envelope produces a withdrawal for the difference', () => {
    const adjustments = computeSweep([
      row({ accountId: 'acc-1', expected: '340.00', counted: '328.00' }),
    ]);
    expect(adjustments).toEqual([
      { accountId: 'acc-1', currencyCode: 'PLN', type: 'withdrawal', amount: '12.00' },
    ]);
  });

  it('a long envelope produces a deposit for the difference', () => {
    const adjustments = computeSweep([
      row({ accountId: 'acc-1', expected: '340.00', counted: '355.50' }),
    ]);
    expect(adjustments).toEqual([
      { accountId: 'acc-1', currencyCode: 'PLN', type: 'deposit', amount: '15.50' },
    ]);
  });

  it('an equal envelope produces nothing', () => {
    expect(
      computeSweep([row({ accountId: 'acc-1', expected: '340.00', counted: '340.00' })]),
    ).toEqual([]);
  });

  it('a blank envelope (not counted) produces nothing', () => {
    expect(computeSweep([row({ accountId: 'acc-1', expected: '340.00', counted: '' })])).toEqual(
      [],
    );
    expect(computeSweep([row({ accountId: 'acc-1', expected: '340.00', counted: '   ' })])).toEqual(
      [],
    );
  });

  it('keeps two currencies as separate adjustments, never converting', () => {
    const adjustments = computeSweep([
      row({ accountId: 'acc-pln', currencyCode: 'PLN', expected: '340.00', counted: '330.00' }),
      row({ accountId: 'acc-eur', currencyCode: 'EUR', expected: '300.00', counted: '310.00' }),
    ]);
    expect(adjustments).toEqual([
      { accountId: 'acc-pln', currencyCode: 'PLN', type: 'withdrawal', amount: '10.00' },
      { accountId: 'acc-eur', currencyCode: 'EUR', type: 'deposit', amount: '10.00' },
    ]);
  });

  it('matches addDecimal with no float drift on a value that would drift as a float', () => {
    const adjustments = computeSweep([
      row({ accountId: 'acc-1', expected: '0.10', counted: '0.30' }),
    ]);
    expect(adjustments).toEqual([
      { accountId: 'acc-1', currencyCode: 'PLN', type: 'deposit', amount: '0.20' },
    ]);
  });

  it('skips blank rows while still producing adjustments for the rest', () => {
    const adjustments = computeSweep([
      row({ accountId: 'acc-1', expected: '340.00', counted: '328.00' }),
      row({ accountId: 'acc-2', expected: '1200.00', counted: '' }),
    ]);
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]!.accountId).toBe('acc-1');
  });
});

describe('driftByCurrency', () => {
  it('sums the signed drift per currency, blank rows excluded', () => {
    const totals = driftByCurrency([
      row({ accountId: 'acc-1', currencyCode: 'PLN', expected: '340.00', counted: '328.00' }),
      row({ accountId: 'acc-2', currencyCode: 'PLN', expected: '1200.00', counted: '1200.00' }),
      row({ accountId: 'acc-3', currencyCode: 'EUR', expected: '300.00', counted: '' }),
    ]);
    expect(totals).toEqual([{ currencyCode: 'PLN', amount: '-12.00' }]);
  });
});
