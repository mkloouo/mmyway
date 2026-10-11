import { autofill, autofillCount, autofillIsEmpty, type AutofillInput } from './autofill';
import type { Envelope } from './envelopes';
import type { Fund } from './funds';

function envelope(over: Partial<Envelope>): Envelope {
  return {
    budgetId: '1',
    name: 'Groceries',
    limitId: null,
    currencyCode: 'PLN',
    assigned: '0',
    spent: '0',
    available: '0',
    overspent: false,
    ...over,
  };
}

function fund(over: Partial<Fund>): Fund {
  return {
    id: 'p1',
    name: 'New laptop',
    saved: '0',
    target: null,
    targetDate: null,
    percentage: null,
    accountId: 'a1',
    accountName: 'Revolut',
    currencyCode: 'PLN',
    groupTitle: null,
    updatedAt: null,
    ...over,
  };
}

function input(over: Partial<AutofillInput>): AutofillInput {
  return {
    readyToAssign: '0',
    envelopes: [],
    lastPeriod: new Map(),
    funds: [],
    today: '2026-10-11',
    decimalPlaces: 2,
    ...over,
  };
}

const last = (pairs: [string, string][]) =>
  new Map(pairs.map(([id, assigned]) => [id, envelope({ budgetId: id, assigned })]));

describe('autofill: envelopes', () => {
  it('brings each envelope back to what it held last month, in order', () => {
    const plan = autofill(
      input({
        readyToAssign: '1000.00',
        envelopes: [
          envelope({ budgetId: '1', name: 'Dining Out', limitId: '41' }),
          envelope({ budgetId: '2', name: 'Groceries', assigned: '100.00', limitId: '42' }),
        ],
        lastPeriod: last([
          ['1', '300.00'],
          ['2', '800.00'],
        ]),
      }),
    );
    expect(plan.envelopes).toEqual([
      { budgetId: '1', amount: '300.00', limitId: '41' },
      // Already holds 100 of the 800 it had: topped up to the target, not given another 800.
      { budgetId: '2', amount: '800.00', limitId: '42' },
    ]);
    expect(plan.total).toBe('1000.00');
    expect(plan.leftover).toBe('0.00');
  });

  it('exhausts Ready to Assign exactly and never over-assigns by a rounding unit', () => {
    const plan = autofill(
      input({
        readyToAssign: '250.01',
        envelopes: [
          envelope({ budgetId: '1', name: 'A' }),
          envelope({ budgetId: '2', name: 'B' }),
          envelope({ budgetId: '3', name: 'C' }),
        ],
        lastPeriod: last([
          ['1', '100.00'],
          ['2', '100.00'],
          ['3', '100.00'],
        ]),
      }),
    );
    expect(plan.envelopes.map((e) => e.amount)).toEqual(['100.00', '100.00', '50.01']);
    expect(plan.total).toBe('250.01');
    expect(plan.leftover).toBe('0.00');
  });

  it('respects the order it is given: the first envelope is filled first', () => {
    const plan = autofill(
      input({
        readyToAssign: '50.00',
        envelopes: [envelope({ budgetId: '1' }), envelope({ budgetId: '2' })],
        lastPeriod: last([
          ['1', '100.00'],
          ['2', '100.00'],
        ]),
      }),
    );
    expect(plan.envelopes).toEqual([{ budgetId: '1', amount: '50.00', limitId: null }]);
  });

  it('skips an envelope that already holds its target, or had nothing last month', () => {
    const plan = autofill(
      input({
        readyToAssign: '500.00',
        envelopes: [
          envelope({ budgetId: '1', assigned: '100.00' }),
          envelope({ budgetId: '2', assigned: '200.00' }),
          envelope({ budgetId: '3' }),
        ],
        lastPeriod: last([
          ['1', '100.00'], // exactly its target
          ['2', '150.00'], // more than its target: never taken back, that is a move
        ]),
        // budget 3 had no limit last month: no target, so auto-fill has no opinion.
      }),
    );
    expect(autofillIsEmpty(plan)).toBe(true);
    expect(plan.leftover).toBe('500.00');
  });

  it('works in a currency with no decimal places', () => {
    const plan = autofill(
      input({
        readyToAssign: '7000',
        envelopes: [envelope({ budgetId: '1' })],
        lastPeriod: last([['1', '25000']]),
        decimalPlaces: 0,
      }),
    );
    expect(plan.envelopes).toEqual([{ budgetId: '1', amount: '7000', limitId: null }]);
  });
});

describe('autofill: sinking funds', () => {
  it('gives a fund one month of what it still needs', () => {
    const plan = autofill(
      input({
        readyToAssign: '1000.00',
        // 3600 short, 4 months to go (October -> February): 900 a month.
        funds: [fund({ target: '3600.00', targetDate: '2027-02-01', updatedAt: 'u1' })],
      }),
    );
    expect(plan.funds).toEqual([
      { piggyId: 'p1', accountId: 'a1', amount: '900.00', expectedUpdatedAt: 'u1' },
    ]);
    expect(plan.leftover).toBe('100.00');
  });

  it('adds the share to what is already saved, since the amount is absolute', () => {
    const plan = autofill(
      input({
        readyToAssign: '1000.00',
        funds: [fund({ saved: '300.00', target: '900.00', targetDate: '2026-12-01' })],
      }),
    );
    // 600 short over 2 months = 300 a month, on top of the 300 already saved.
    expect(plan.funds[0]!.amount).toBe('600.00');
  });

  it('rounds the monthly share up, so the last month is never a unit short', () => {
    const plan = autofill(
      input({
        readyToAssign: '1000.00',
        funds: [fund({ target: '10.00', targetDate: '2027-01-01' })],
      }),
    );
    // October to January is 3 months; 10.00 over 3 is 3.333…, so 3.34, not 3.33.
    expect(plan.funds[0]!.amount).toBe('3.34');
  });

  it('treats a past or missing target date as this month, never dividing by zero', () => {
    const now = autofill(
      input({ readyToAssign: '1000.00', funds: [fund({ target: '500.00', targetDate: null })] }),
    );
    expect(now.funds[0]!.amount).toBe('500.00');
    const overdue = autofill(
      input({
        readyToAssign: '1000.00',
        funds: [fund({ target: '500.00', targetDate: '2026-01-01' })],
      }),
    );
    expect(overdue.funds[0]!.amount).toBe('500.00');
  });

  it('leaves an open-ended fund, a full one, and one with no account alone', () => {
    const plan = autofill(
      input({
        readyToAssign: '1000.00',
        funds: [
          fund({ id: 'open', target: null }),
          fund({ id: 'full', saved: '500.00', target: '500.00', targetDate: '2027-01-01' }),
          fund({ id: 'detached', target: '500.00', accountId: null }),
        ],
      }),
    );
    expect(plan.funds).toEqual([]);
  });

  it('fills the envelopes before the funds, and the funds only with what is left', () => {
    const plan = autofill(
      input({
        readyToAssign: '120.00',
        envelopes: [envelope({ budgetId: '1' })],
        lastPeriod: last([['1', '100.00']]),
        funds: [fund({ target: '600.00', targetDate: '2026-11-01' })],
      }),
    );
    expect(plan.envelopes).toEqual([{ budgetId: '1', amount: '100.00', limitId: null }]);
    // 20 is all that was left, though the fund's own monthly share would be 600.
    expect(plan.funds[0]!.amount).toBe('20.00');
    expect(plan.leftover).toBe('0.00');
    expect(autofillCount(plan)).toBe(2);
  });
});

describe('autofill with nothing to give', () => {
  it('plans nothing for a zero or negative Ready to Assign, and does not crash', () => {
    const envelopes = [envelope({ budgetId: '1' })];
    const lastPeriod = last([['1', '100.00']]);
    const funds = [fund({ target: '500.00', targetDate: '2027-01-01' })];
    for (const readyToAssign of ['0', '-120.00']) {
      const plan = autofill(input({ readyToAssign, envelopes, lastPeriod, funds }));
      expect(autofillIsEmpty(plan)).toBe(true);
      expect(autofillCount(plan)).toBe(0);
    }
  });
});
