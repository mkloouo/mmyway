import { categoryColor } from './categoryColor';

describe('categoryColor', () => {
  it('is stable for the same category and differs across themes', () => {
    expect(categoryColor('Groceries')).toBe(categoryColor('Groceries'));
    expect(categoryColor('Groceries', true)).not.toBe(categoryColor('Groceries'));
  });

  it('ignores case and diacritics, as normkey does', () => {
    expect(categoryColor('Car Fuel')).toBe(categoryColor('car fuel'));
  });

  it('spreads a realistic category list over several hues', () => {
    const names = [
      'Groceries',
      'Medicine',
      'Doctors',
      'Cat',
      'Beauty',
      'Car Fuel',
      'Pastime',
      'House Supplies',
    ];
    expect(new Set(names.map((n) => categoryColor(n))).size).toBeGreaterThan(4);
  });
});
