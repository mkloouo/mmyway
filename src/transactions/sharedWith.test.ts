import { sharedNames, sharedTags, sharedWithFromTags, withSharedWith } from './sharedWith';

describe('shared with', () => {
  it('splits names on commas, trimmed, without blanks or repeats', () => {
    expect(sharedNames(' Anna, Bob,, anna ,')).toEqual(['Anna', 'Bob']);
    expect(sharedNames('')).toEqual([]);
    expect(sharedNames(null)).toEqual([]);
  });

  it('gives each person a tag', () => {
    expect(sharedTags('Anna, Bob')).toEqual(['mmyway-shared-Anna', 'mmyway-shared-Bob']);
  });

  it('reads every shared-with tag, not only the first', () => {
    expect(sharedWithFromTags(['groceries', 'mmyway-shared-Anna', 'mmyway-shared-Bob'])).toBe(
      'Anna, Bob',
    );
    expect(sharedWithFromTags(['groceries'])).toBeNull();
  });

  it('keeps the second person when the field is saved as shown', () => {
    const tags = ['mmyway-shared-Anna', 'trip', 'mmyway-shared-Bob'];
    expect(withSharedWith(tags, sharedWithFromTags(tags))).toEqual([
      'trip',
      'mmyway-shared-Anna',
      'mmyway-shared-Bob',
    ]);
  });

  it('drops only the names removed from the field, and keeps the other tags', () => {
    expect(withSharedWith(['mmyway-shared-Anna', 'trip', 'mmyway-shared-Bob'], 'Bob')).toEqual([
      'trip',
      'mmyway-shared-Bob',
    ]);
    expect(withSharedWith(['mmyway-shared-Anna', 'trip'], null)).toEqual(['trip']);
  });
});
