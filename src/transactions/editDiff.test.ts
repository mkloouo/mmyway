import { changedFields, sameAmount, sameSplits, sendableNotes } from './editDiff';

describe('changedFields', () => {
  const baseline = {
    amount: '12.500000000000', date: '2026-09-28T12:00:00+02:00', category_name: 'Food', notes: undefined, tags: ['a', 'b'], source_id: '1',
  };

  it('drops what was touched but not changed', () => {
    expect(changedFields({
      amount: '12.5', date: '2026-09-28T10:00:00.000Z', category_name: 'Food', notes: '', tags: ['b', 'a'], source_id: '1',
    }, baseline)).toEqual({});
  });

  it('keeps real changes', () => {
    expect(changedFields({ amount: '13', category_name: 'Rent', source_id: '2' }, baseline))
      .toEqual({ amount: '13', category_name: 'Rent', source_id: '2' });
  });

  it('sends a cleared note as null, never an empty string', () => {
    expect(changedFields({ notes: '' }, { notes: 'old note' })).toEqual({ notes: null });
  });

  it('ignores fields set to undefined', () => {
    expect(changedFields({ budget_id: undefined }, { budget_id: '3' })).toEqual({});
  });
});

describe('sameSplits', () => {
  const split = { amount: '10.00', description: 'Milk', notes: null, category_name: 'Food', tags: [] };

  it('treats equal amounts, and empty and missing notes, as the same', () => {
    expect(sameSplits([split], [{ ...split, amount: '10', notes: undefined }])).toBe(true);
  });

  it('sees a changed field, and a split added or removed', () => {
    expect(sameSplits([split], [{ ...split, category_name: 'Rent' }])).toBe(false);
    expect(sameSplits([split], [split, split])).toBe(false);
  });
});

describe('small helpers', () => {
  it('compares amounts by value', () => {
    expect(sameAmount('7.990000000000', '7.99')).toBe(true);
    expect(sameAmount('7.99', '7.9')).toBe(false);
  });

  it('turns an empty note into null', () => {
    expect(sendableNotes('')).toBeNull();
    expect(sendableNotes(null)).toBeNull();
    expect(sendableNotes('x')).toBe('x');
  });
});
