import { sameRows } from './useLiveQuery';

describe('sameRows', () => {
  it('holds a re-read of unchanged rows equal', () => {
    expect(sameRows([{ id: '1', name: 'Cash' }], [{ id: '1', name: 'Cash' }])).toBe(true);
  });

  it('sees a changed value, a new key and a different length', () => {
    expect(sameRows([{ id: '1', name: 'Cash' }], [{ id: '1', name: 'Card' }])).toBe(false);
    expect(sameRows([{ id: '1' }], [{ id: '1', name: 'Cash' }])).toBe(false);
    expect(sameRows([{ id: '1' }], [{ id: '1' }, { id: '2' }])).toBe(false);
  });

  it('treats undefined (the first read) as different from any array', () => {
    expect(sameRows(undefined, [])).toBe(false);
  });
});
