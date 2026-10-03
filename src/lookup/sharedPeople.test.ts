import { sharedPeopleFrom } from './sharedPeople';

const row = (date: string, ...names: string[]) => ({
  date,
  tagsJson: JSON.stringify(names.map((n) => `mmyway-shared-${n}`)),
});

describe('sharedPeopleFrom', () => {
  it('lists the people most recently shared with first', () => {
    expect(
      sharedPeopleFrom([
        row('2026-01-01', 'Anna'),
        row('2026-03-01', 'Bob'),
        row('2026-02-01', 'Cara'),
      ]),
    ).toEqual(['Bob', 'Cara', 'Anna']);
  });

  it('counts a person once, spelled as the latest transaction spells them', () => {
    expect(sharedPeopleFrom([row('2026-01-01', 'anna'), row('2026-02-01', 'Anna')])).toEqual([
      'Anna',
    ]);
  });

  it('ignores other tags and rows whose tags cannot be read', () => {
    expect(
      sharedPeopleFrom([
        { date: '2026-01-01', tagsJson: '["holiday","mmyway-reconcile"]' },
        { date: '2026-01-02', tagsJson: 'not json' },
        row('2026-01-03', 'Anna'),
      ]),
    ).toEqual(['Anna']);
  });

  it('stops at eight, the most recent ones', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      row(`2026-01-${String(i + 1).padStart(2, '0')}`, `P${i}`),
    );
    const people = sharedPeopleFrom(many);
    expect(people).toHaveLength(8);
    expect(people[0]).toBe('P11');
  });
});
