import { freshPosition, roundPosition } from './position';

describe('a position fix', () => {
  const here = { latitude: 52.2297, longitude: 21.0122 };

  it('is rounded to five decimals, a few metres, with the accuracy kept whole', () => {
    expect(
      roundPosition({ latitude: 52.2297123456, longitude: 21.0122987654, accuracy: 23.7 }),
    ).toEqual({ latitude: 52.22971, longitude: 21.0123, accuracyM: 24 });
  });

  it('leaves out an accuracy the phone did not report', () => {
    expect(roundPosition({ latitude: 52.2297, longitude: 21.0122, accuracy: null })).toEqual(here);
  });

  it('stands in for "here" for ten minutes, and no longer', () => {
    const now = 1_700_000_000_000;
    expect(freshPosition({ at: now - 60_000, position: here }, now)).toEqual(here);
    expect(freshPosition({ at: now - 11 * 60_000, position: here }, now)).toBeUndefined();
    expect(freshPosition(null, now)).toBeUndefined();
  });
});
