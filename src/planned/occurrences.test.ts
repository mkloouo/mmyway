import { expandRepetition, upcomingOccurrences, withWeekendRule } from './occurrences';
import { repetitionFromFF3, type Repetition } from './repetition';
import type { RecurrenceRepetition } from './objects';

/**
 * The cross-check the plan asks for: each case is a repetition as Firefly III holds it, together
 * with the `occurrences` its own enrichment produced for that repetition
 * (`getXOccurrencesSince(repetition, first_date, …)`, which is where the app's cache gets them
 * from). The expander has to reproduce them exactly, or the agenda it draws beyond FF3's five
 * dates would disagree with the five FF3 sent. Each date here is also checkable by calendar.
 */
const FF3_CASES: {
  what: string;
  from: string;
  repetition: RecurrenceRepetition;
  occurrences: string[];
}[] = [
  {
    what: 'daily, every day — FF3 sends nine of these, not five',
    from: '2026-01-01',
    repetition: { type: 'daily', moment: '', skip: 0, weekend: 1 },
    occurrences: [
      '2026-01-01T00:00:00+01:00',
      '2026-01-02T00:00:00+01:00',
      '2026-01-03T00:00:00+01:00',
      '2026-01-04T00:00:00+01:00',
      '2026-01-05T00:00:00+01:00',
      '2026-01-06T00:00:00+01:00',
      '2026-01-07T00:00:00+01:00',
      '2026-01-08T00:00:00+01:00',
      '2026-01-09T00:00:00+01:00',
    ],
  },
  {
    what: 'daily, every third day',
    from: '2026-01-01',
    repetition: { type: 'daily', moment: '', skip: 2, weekend: 1 },
    occurrences: [
      '2026-01-01T00:00:00+01:00',
      '2026-01-04T00:00:00+01:00',
      '2026-01-07T00:00:00+01:00',
      '2026-01-10T00:00:00+01:00',
      '2026-01-13T00:00:00+01:00',
    ],
  },
  {
    what: 'weekly on a Wednesday, every second week (2026-01-01 is a Thursday)',
    from: '2026-01-01',
    repetition: { type: 'weekly', moment: '3', skip: 1, weekend: 1 },
    occurrences: [
      '2026-01-07T00:00:00+01:00',
      '2026-01-21T00:00:00+01:00',
      '2026-02-04T00:00:00+01:00',
      '2026-02-18T00:00:00+01:00',
      '2026-03-04T00:00:00+01:00',
    ],
  },
  {
    what: 'monthly on the 5th',
    from: '2026-01-05',
    repetition: { type: 'monthly', moment: '5', skip: 0, weekend: 1 },
    occurrences: [
      '2026-01-05T00:00:00+01:00',
      '2026-02-05T00:00:00+01:00',
      '2026-03-05T00:00:00+01:00',
      '2026-04-05T00:00:00+02:00',
      '2026-05-05T00:00:00+02:00',
    ],
  },
  {
    what: 'monthly on the 31st — a short month is pulled back to its last day',
    from: '2026-01-31',
    repetition: { type: 'monthly', moment: '31', skip: 0, weekend: 1 },
    occurrences: [
      '2026-01-31T00:00:00+01:00',
      '2026-02-28T00:00:00+01:00',
      '2026-03-31T00:00:00+02:00',
      '2026-04-30T00:00:00+02:00',
      '2026-05-31T00:00:00+02:00',
    ],
  },
  {
    what: 'monthly on the 15th, every third month',
    from: '2026-01-15',
    repetition: { type: 'monthly', moment: '15', skip: 2, weekend: 1 },
    occurrences: [
      '2026-01-15T00:00:00+01:00',
      '2026-04-15T00:00:00+02:00',
      '2026-07-15T00:00:00+02:00',
      '2026-10-15T00:00:00+02:00',
      '2027-01-15T00:00:00+01:00',
    ],
  },
  {
    what: 'ndom — the second Monday of the month',
    from: '2026-01-01',
    repetition: { type: 'ndom', moment: '2,1', skip: 0, weekend: 1 },
    occurrences: [
      '2026-01-12T00:00:00+01:00',
      '2026-02-09T00:00:00+01:00',
      '2026-03-09T00:00:00+01:00',
      '2026-04-13T00:00:00+02:00',
      '2026-05-11T00:00:00+02:00',
    ],
  },
  {
    what: 'yearly on 15 March',
    from: '2026-01-01',
    repetition: { type: 'yearly', moment: '2026-03-15', skip: 0, weekend: 1 },
    occurrences: [
      '2026-03-15T00:00:00+01:00',
      '2027-03-15T00:00:00+01:00',
      '2028-03-15T00:00:00+01:00',
      '2029-03-15T00:00:00+01:00',
      '2030-03-15T00:00:00+01:00',
    ],
  },
];

describe('the expander against Firefly III’s own occurrences', () => {
  for (const c of FF3_CASES) {
    it(`matches FF3 for ${c.what}`, () => {
      const expected = c.occurrences.map((d) => d.slice(0, 10));
      expect(expandRepetition(repetitionFromFF3(c.repetition), c.from, expected.length)).toEqual(
        expected,
      );
    });
  }
});

describe('expandRepetition', () => {
  it('starts from the first date on or after `from`, not before it', () => {
    const rep: Repetition = { type: 'monthly', moment: '5', skip: 0, weekend: 1 };
    expect(expandRepetition(rep, '2026-01-06', 2)).toEqual(['2026-02-05', '2026-03-05']);
    expect(expandRepetition(rep, '2026-01-05', 2)).toEqual(['2026-01-05', '2026-02-05']);
  });

  it('counts whole weeks for an nth the month does not have, as FF3 does', () => {
    // February 2026 has four Mondays, so a "5th Monday" lands in March — FF3 adds weeks from the
    // first matching weekday rather than clamping, and the expander reproduces that.
    const fifth: Repetition = { type: 'ndom', moment: '5,1', skip: 0, weekend: 1 };
    expect(expandRepetition(fifth, '2026-02-01', 1)).toEqual(['2026-03-02']);
  });

  it('gives nothing for a date or a count it cannot work with', () => {
    const rep: Repetition = { type: 'monthly', moment: '5', skip: 0, weekend: 1 };
    expect(expandRepetition(rep, 'not a date', 3)).toEqual([]);
    expect(expandRepetition(rep, '2026-01-01', 0)).toEqual([]);
    expect(
      expandRepetition({ type: 'yearly', moment: '', skip: 0, weekend: 1 }, '2026-01-01', 3),
    ).toEqual([]);
  });
});

describe('withWeekendRule', () => {
  // 2026-01-03 is a Saturday and 2026-01-04 a Sunday.
  it('leaves a weekday alone whatever the rule', () => {
    for (const rule of [1, 2, 3, 4] as const)
      expect(withWeekendRule('2026-01-05', rule)).toBe('2026-01-05');
  });

  it('keeps, drops, or moves a weekend date', () => {
    expect(withWeekendRule('2026-01-03', 1)).toBe('2026-01-03');
    expect(withWeekendRule('2026-01-03', 2)).toBeNull();
    expect(withWeekendRule('2026-01-03', 3)).toBe('2026-01-02');
    expect(withWeekendRule('2026-01-04', 3)).toBe('2026-01-02');
    expect(withWeekendRule('2026-01-03', 4)).toBe('2026-01-05');
    expect(withWeekendRule('2026-01-04', 4)).toBe('2026-01-05');
  });

  it('is idempotent, so FF3’s own dates can be put through it', () => {
    for (const rule of [3, 4] as const) {
      const moved = withWeekendRule('2026-01-03', rule)!;
      expect(withWeekendRule(moved, rule)).toBe(moved);
    }
  });
});

describe('upcomingOccurrences', () => {
  it('merges every repetition, sorted, without duplicates', () => {
    const first: Repetition = { type: 'monthly', moment: '1', skip: 0, weekend: 1 };
    const fifteenth: Repetition = { type: 'monthly', moment: '15', skip: 0, weekend: 1 };
    expect(upcomingOccurrences([first, fifteenth], '2026-01-01', { count: 4 })).toEqual([
      '2026-01-01',
      '2026-01-15',
      '2026-02-01',
      '2026-02-15',
    ]);
    expect(upcomingOccurrences([first, first], '2026-01-01', { count: 2 })).toEqual([
      '2026-01-01',
      '2026-02-01',
    ]);
  });

  it('drops the dates the user skipped and stops at `until`', () => {
    const first: Repetition = { type: 'monthly', moment: '1', skip: 0, weekend: 1 };
    expect(
      upcomingOccurrences([first], '2026-01-01', { count: 5, skipDays: ['2026-02-01'] }),
    ).toEqual(['2026-01-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01']);
    expect(upcomingOccurrences([first], '2026-01-01', { count: 5, until: '2026-03-15' })).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
    ]);
  });

  it('keeps the list full when a weekend rule drops dates', () => {
    // Every Saturday, skipped: nothing is ever booked, and the list says so rather than looping.
    const saturday: Repetition = { type: 'weekly', moment: '6', skip: 0, weekend: 2 };
    expect(upcomingOccurrences([saturday], '2026-01-01', { count: 3 })).toEqual([]);
    // Every Saturday, moved to the Monday.
    const moved: Repetition = { type: 'weekly', moment: '6', skip: 0, weekend: 4 };
    expect(upcomingOccurrences([moved], '2026-01-01', { count: 3 })).toEqual([
      '2026-01-05',
      '2026-01-12',
      '2026-01-19',
    ]);
  });
});
