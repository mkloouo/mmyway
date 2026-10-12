import { upcomingTotals, type Totalled } from './upcomingTotals';

const window = { from: '2026-10-12', until: '2026-11-10' };
const occ = (over: Partial<Totalled>): Totalled => ({
  day: '2026-10-15',
  skipped: false,
  type: 'withdrawal',
  amount: '0',
  currencyCode: 'PLN',
  ...over,
});

describe('upcomingTotals', () => {
  it('adds withdrawals to out and deposits to in, per currency, in decimal strings', () => {
    const totals = upcomingTotals(
      [
        occ({ amount: '2400.00' }),
        occ({ amount: '60.10', day: '2026-10-20' }),
        occ({ type: 'deposit', amount: '8000' }),
        occ({ amount: '1000.50', currencyCode: 'EUR' }),
      ],
      window,
    );
    expect(totals).toEqual({
      PLN: { out: '2460.10', in: '8000' },
      EUR: { out: '1000.50', in: '0' },
    });
  });

  it('leaves out skipped occurrences and transfers', () => {
    const totals = upcomingTotals(
      [
        occ({ amount: '2400.00' }),
        occ({ amount: '180.00', skipped: true }),
        occ({ type: 'transfer', amount: '500' }),
        occ({ type: 'deposit', amount: '300', skipped: true }),
      ],
      window,
    );
    expect(totals).toEqual({ PLN: { out: '2400.00', in: '0' } });
  });

  it('counts only the occurrences inside the window, both ends included', () => {
    const totals = upcomingTotals(
      [
        occ({ amount: '1', day: '2026-10-11' }),
        occ({ amount: '10', day: '2026-10-12' }),
        occ({ amount: '100', day: '2026-11-10' }),
        occ({ amount: '1000', day: '2026-11-11' }),
      ],
      window,
    );
    expect(totals).toEqual({ PLN: { out: '110', in: '0' } });
  });

  it('has no entry for a currency with nothing counted', () => {
    const totals = upcomingTotals(
      [occ({ amount: '5', skipped: true, currencyCode: 'USD' })],
      window,
    );
    expect(totals).toEqual({});
  });
});
