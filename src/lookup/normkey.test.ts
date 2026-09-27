import { normkey } from './normkey';

describe('normkey', () => {
  it('folds diacritics and lowercases', () => {
    expect(normkey('Żabka')).toBe('zabka');
  });
  it('maps ł to l', () => {
    expect(normkey('Rossmańska Łódź')).toBe('rossmanskalodz');
  });
  it('keeps Cyrillic', () => {
    expect(normkey('Жабка Снікерс')).toBe('жабкаснікерс');
  });
  it('drops punctuation and spaces', () => {
    expect(normkey('PE PLN account!')).toBe('peplnaccount');
  });
});
