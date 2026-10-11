import { autofill, autofillTotal, type AutofillInput } from './autofill';
import type { Envelope } from './envelopes';

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

function input(over: Partial<AutofillInput>): AutofillInput {
  return { readyToAssign: '0', envelopes: [], lastPeriod: new Map(), decimalPlaces: 2, ...over };
}

const last = (pairs: [string, string][]) =>
  new Map(pairs.map(([id, assigned]) => [id, envelope({ budgetId: id, assigned })]));

describe('autofill', () => {
  it('brings each envelope back to what it held last month, in order', () => {
    expect(
      autofill(
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
      ),
    ).toEqual([
      { budgetId: '1', amount: '300.00', limitId: '41' },
      // Already holds 100 of the 800 it had: topped up to the target, not given another 800.
      { budgetId: '2', amount: '800.00', limitId: '42' },
    ]);
  });

  it('exhausts Ready to Assign exactly and never over-assigns by a rounding unit', () => {
    const entries = autofill(
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
    expect(entries.map((e) => e.amount)).toEqual(['100.00', '100.00', '50.01']);
    expect(autofillTotal(entries, [], 2)).toBe('250.01');
  });

  it('respects the order it is given: the first envelope is filled first', () => {
    const entries = autofill(
      input({
        readyToAssign: '50.00',
        envelopes: [envelope({ budgetId: '1' }), envelope({ budgetId: '2' })],
        lastPeriod: last([
          ['1', '100.00'],
          ['2', '100.00'],
        ]),
      }),
    );
    expect(entries).toEqual([{ budgetId: '1', amount: '50.00', limitId: null }]);
  });

  it('gives nothing when Ready to Assign is zero or negative, and does not crash', () => {
    const envelopes = [envelope({ budgetId: '1' })];
    const lastPeriod = last([['1', '100.00']]);
    expect(autofill(input({ readyToAssign: '0', envelopes, lastPeriod }))).toEqual([]);
    expect(autofill(input({ readyToAssign: '-120.00', envelopes, lastPeriod }))).toEqual([]);
  });

  it('skips an envelope that already holds its target, or had nothing last month', () => {
    expect(
      autofill(
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
      ),
    ).toEqual([]);
  });

  it('works in a currency with no decimal places', () => {
    expect(
      autofill(
        input({
          readyToAssign: '7000',
          envelopes: [envelope({ budgetId: '1' })],
          lastPeriod: last([['1', '25000']]),
          decimalPlaces: 0,
        }),
      ),
    ).toEqual([{ budgetId: '1', amount: '7000', limitId: null }]);
  });
});

describe('autofillTotal', () => {
  it('is what the assignment adds, not what the envelopes end up holding', () => {
    const envelopes = [envelope({ budgetId: '1', assigned: '100.00' })];
    expect(autofillTotal([{ budgetId: '1', amount: '300.00' }], envelopes, 2)).toBe('200.00');
  });
});
