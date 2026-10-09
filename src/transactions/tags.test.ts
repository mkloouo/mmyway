import { isUserTag, parseTags, splitTags, userTags, withUserTags } from './tags';

describe('isUserTag', () => {
  it('recognizes regular tags as user tags', () => {
    expect(isUserTag('groceries')).toBe(true);
    expect(isUserTag('trip')).toBe(true);
    expect(isUserTag('vacation-2026')).toBe(true);
  });

  it('filters out internal mmyway- tags', () => {
    expect(isUserTag('mmyway-shared-Anna')).toBe(false);
    expect(isUserTag('mmyway-reviewed')).toBe(false);
    expect(isUserTag('mmyway-reconcile')).toBe(false);
  });
});

describe('userTags', () => {
  it('extracts only user tags from a mixed list', () => {
    const mixed = ['food', 'mmyway-shared-Bob', 'trip', 'mmyway-reviewed'];
    expect(userTags(mixed)).toEqual(['food', 'trip']);
  });
});

describe('splitTags', () => {
  it('splits by comma and strips whitespace', () => {
    expect(splitTags(' food, trip , shopping ')).toEqual(['food', 'trip', 'shopping']);
  });

  it('deduplicates case-insensitively while preserving first casing', () => {
    expect(splitTags('Food, food, FOOD, trip')).toEqual(['Food', 'trip']);
  });

  it('handles empty string', () => {
    expect(splitTags('')).toEqual([]);
    expect(splitTags('   , , ')).toEqual([]);
  });
});

describe('withUserTags', () => {
  it('replaces existing user tags while preserving internal mmyway tags', () => {
    const existing = ['oldTag', 'mmyway-shared-Anna', 'mmyway-reviewed'];
    const updated = withUserTags(existing, ['newTag', 'holiday']);
    expect(updated).toEqual(['mmyway-shared-Anna', 'mmyway-reviewed', 'newTag', 'holiday']);
  });

  it('allows clearing all user tags while keeping internal tags', () => {
    const existing = ['groceries', 'mmyway-shared-Anna'];
    const updated = withUserTags(existing, []);
    expect(updated).toEqual(['mmyway-shared-Anna']);
  });
});

describe('parseTags', () => {
  it('parses valid json array', () => {
    expect(parseTags('["a","b"]')).toEqual(['a', 'b']);
  });

  it('handles invalid json or non-array gracefully', () => {
    expect(parseTags('')).toEqual([]);
    expect(parseTags(null)).toEqual([]);
    expect(parseTags('bad-json')).toEqual([]);
    expect(parseTags('{"a":1}')).toEqual([]);
  });
});
