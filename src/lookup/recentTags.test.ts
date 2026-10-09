import { recentTagsFrom } from './recentTags';

describe('recentTagsFrom', () => {
  it('extracts unique user tags ordered by most recent date', () => {
    const rows = [
      { date: '2026-10-01', tagsJson: '["food", "lunch"]' },
      { date: '2026-10-05', tagsJson: '["groceries", "food"]' },
      { date: '2026-09-20', tagsJson: '["old"]' },
    ];
    const result = recentTagsFrom(rows);
    expect(result).toEqual(['food', 'groceries', 'lunch', 'old']);
  });

  it('ignores internal mmyway- tags', () => {
    const rows = [
      { date: '2026-10-01', tagsJson: '["trip", "mmyway-shared-Anna", "mmyway-reviewed"]' },
    ];
    expect(recentTagsFrom(rows)).toEqual(['trip']);
  });

  it('limits to 10 most recent tags', () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({
      date: `2026-10-${String(i + 1).padStart(2, '0')}`,
      tagsJson: JSON.stringify([`tag-${i}`]),
    }));
    const result = recentTagsFrom(rows);
    expect(result.length).toBe(10);
    expect(result[0]).toBe('tag-14');
  });
});
