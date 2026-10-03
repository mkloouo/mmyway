import {
  sharedNames,
  sharedNamesFromTags,
  sharedTags,
  sharedWithFromTags,
  toggleSharedName,
  withSharedWith,
} from './sharedWith';

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

describe('toggleSharedName', () => {
  it('adds a name that is not there and takes out one that is', () => {
    expect(toggleSharedName('', 'Anna')).toBe('Anna');
    expect(toggleSharedName('Anna', 'Bob')).toBe('Anna, Bob');
    expect(toggleSharedName('Anna, Bob', 'Anna')).toBe('Bob');
    expect(toggleSharedName('Anna, Bob', 'Bob')).toBe('Anna');
  });

  it('matches the person however the name is cased or spaced', () => {
    expect(toggleSharedName('Anna, Bob', ' anna ')).toBe('Bob');
    expect(toggleSharedName(null, ' Anna ')).toBe('Anna');
  });
});

describe('sharedNamesFromTags', () => {
  it('reads the people out, ignoring every other tag', () => {
    expect(
      sharedNamesFromTags(['mmyway-reconcile', 'mmyway-shared-Anna', 'holiday', 'mmyway-shared-']),
    ).toEqual(['Anna']);
  });
});
