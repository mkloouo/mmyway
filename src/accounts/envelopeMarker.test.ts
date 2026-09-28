import { hasEnvelopeMarker, setEnvelopeMarker } from './envelopeMarker';

describe('hasEnvelopeMarker', () => {
  it('is false for null, undefined and empty notes', () => {
    expect(hasEnvelopeMarker(null)).toBe(false);
    expect(hasEnvelopeMarker(undefined)).toBe(false);
    expect(hasEnvelopeMarker('')).toBe(false);
  });

  it('is true when the marker is any line, not just the whole string', () => {
    expect(hasEnvelopeMarker('mmyway-envelope')).toBe(true);
    expect(hasEnvelopeMarker('Kept in the bedroom drawer\nmmyway-envelope')).toBe(true);
  });

  it('is false when the marker is only a substring of a line', () => {
    expect(hasEnvelopeMarker('not-mmyway-envelope-really')).toBe(false);
  });
});

describe('setEnvelopeMarker', () => {
  it('sets the marker on empty notes', () => {
    expect(setEnvelopeMarker(null, true)).toBe('mmyway-envelope');
    expect(setEnvelopeMarker('', true)).toBe('mmyway-envelope');
  });

  it('appends the marker on a line of its own, keeping existing text', () => {
    expect(setEnvelopeMarker('Kept in the bedroom drawer', true)).toBe(
      'Kept in the bedroom drawer\nmmyway-envelope',
    );
  });

  it('is idempotent when the marker is already set', () => {
    const withMarker = 'Kept in the bedroom drawer\nmmyway-envelope';
    expect(setEnvelopeMarker(withMarker, true)).toBe(withMarker);
  });

  it('removes the marker while leaving every other line untouched', () => {
    expect(setEnvelopeMarker('Line one\nmmyway-envelope\nLine two', false)).toBe(
      'Line one\nLine two',
    );
  });

  it('is a no-op removing an absent marker', () => {
    expect(setEnvelopeMarker('Just a note', false)).toBe('Just a note');
    expect(setEnvelopeMarker(null, false)).toBe('');
  });
});
