import { sanitizeNotes, sanitizeTags, sanitizeLocation, sanitizeSplit } from './sanitize';

describe('sanitizeNotes', () => {
  it('turns empty strings and whitespace into null', () => {
    expect(sanitizeNotes('')).toBeNull();
    expect(sanitizeNotes('   ')).toBeNull();
    expect(sanitizeNotes(null)).toBeNull();
  });

  it('keeps non-empty strings and undefined untouched', () => {
    expect(sanitizeNotes('coffee')).toBe('coffee');
    expect(sanitizeNotes(undefined)).toBeUndefined();
  });
});

describe('sanitizeTags', () => {
  it('omits empty arrays, null, undefined, and arrays of blank strings', () => {
    expect(sanitizeTags([])).toBeUndefined();
    expect(sanitizeTags(null)).toBeUndefined();
    expect(sanitizeTags(undefined)).toBeUndefined();
    expect(sanitizeTags(['', '   '])).toBeUndefined();
  });

  it('trims and keeps valid tags', () => {
    expect(sanitizeTags([' tag1 ', 'tag2', ''])).toEqual(['tag1', 'tag2']);
  });
});

describe('sanitizeLocation', () => {
  it('omits coordinates if latitude or longitude is missing', () => {
    expect(sanitizeLocation({ latitude: 52.2 })).toEqual({});
    expect(sanitizeLocation({ longitude: 21.0 })).toEqual({});
    expect(sanitizeLocation({})).toEqual({});
  });

  it('includes coordinates with default zoom_level if both present', () => {
    expect(sanitizeLocation({ latitude: 52.2, longitude: 21.0 })).toEqual({
      latitude: 52.2,
      longitude: 21.0,
      zoom_level: 16,
    });
  });
});

describe('sanitizeSplit', () => {
  it('cleans notes, tags, coordinates, and text in one pass', () => {
    const split = {
      description: '  Lunch  ',
      notes: '   ',
      tags: [''],
      latitude: 50.1,
      category_name: '',
    };
    const cleaned = sanitizeSplit(split);
    expect(cleaned).toEqual({
      description: 'Lunch',
      notes: null,
      category_name: null,
    });
    expect(cleaned).not.toHaveProperty('tags');
    expect(cleaned).not.toHaveProperty('latitude');
  });
});
