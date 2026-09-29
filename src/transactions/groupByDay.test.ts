import { groupByDay, type DayTransaction } from './groupByDay';

process.env.TZ = 'UTC'; // fixture times are mid-day UTC; pin the runner so day grouping is deterministic

function row(
  overrides: Partial<DayTransaction> & Pick<DayTransaction, 'groupId' | 'date'>,
): DayTransaction {
  return { amount: '10.00', currencyCode: 'PLN', type: 'withdrawal', ...overrides };
}

describe('groupByDay', () => {
  it('returns nothing for an empty input', () => {
    expect(groupByDay([])).toEqual([]);
  });

  it('orders days newest first and rows within a day newest first', () => {
    const sections = groupByDay([
      row({ groupId: 'a', date: '2026-09-25T10:00:00.000Z' }),
      row({ groupId: 'b', date: '2026-09-27T08:00:00.000Z' }),
      row({ groupId: 'c', date: '2026-09-27T14:00:00.000Z' }),
    ]);
    expect(sections.map((s) => s.key)).toEqual(['2026-09-27', '2026-09-25']);
    expect(sections[0]!.data.map((r) => r.groupId)).toEqual(['c', 'b']);
  });

  it('sums a withdrawal and a deposit in the same currency, netting spend against income', () => {
    const sections = groupByDay([
      row({ groupId: 'a', date: '2026-09-27T10:00:00.000Z', type: 'withdrawal', amount: '22.41' }),
      row({ groupId: 'b', date: '2026-09-27T11:00:00.000Z', type: 'deposit', amount: '100.00' }),
    ]);
    expect(sections[0]!.totals).toEqual([{ currencyCode: 'PLN', amount: '77.59' }]);
  });

  it('keeps a mixed-currency day as separate totals', () => {
    const sections = groupByDay([
      row({ groupId: 'a', date: '2026-09-27T10:00:00.000Z', currencyCode: 'PLN', amount: '20.00' }),
      row({ groupId: 'b', date: '2026-09-27T11:00:00.000Z', currencyCode: 'EUR', amount: '5.00' }),
    ]);
    expect(sections[0]!.totals).toEqual(
      expect.arrayContaining([
        { currencyCode: 'PLN', amount: '-20.00' },
        { currencyCode: 'EUR', amount: '-5.00' },
      ]),
    );
    expect(sections[0]!.totals).toHaveLength(2);
  });

  it('excludes a transfer from the total but keeps it listed', () => {
    const sections = groupByDay([
      row({ groupId: 'a', date: '2026-09-27T10:00:00.000Z', type: 'transfer', amount: '500.00' }),
      row({ groupId: 'b', date: '2026-09-27T11:00:00.000Z', type: 'withdrawal', amount: '10.00' }),
    ]);
    expect(sections[0]!.totals).toEqual([{ currencyCode: 'PLN', amount: '-10.00' }]);
    expect(sections[0]!.data).toHaveLength(2);
  });

  it('sums with no float drift (0.1 + 0.2 style case)', () => {
    const sections = groupByDay([
      row({ groupId: 'a', date: '2026-09-27T10:00:00.000Z', type: 'deposit', amount: '0.10' }),
      row({ groupId: 'b', date: '2026-09-27T11:00:00.000Z', type: 'deposit', amount: '0.20' }),
    ]);
    expect(sections[0]!.totals).toEqual([{ currencyCode: 'PLN', amount: '0.30' }]);
  });
});
