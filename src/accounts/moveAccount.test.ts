import { applyVisibleOrder } from './moveAccount';

// a, b, c, d in FF3 order; x and y are inactive and hidden.
const all = ['a', 'x', 'b', 'y', 'c', 'd'];

describe('applyVisibleOrder', () => {
  it('with nothing hidden, takes the new order as it is', () => {
    expect(applyVisibleOrder(['a', 'b', 'c'], ['b', 'a', 'c'])).toEqual(['b', 'a', 'c']);
  });

  it('weaves the visible accounts back in, leaving hidden ones where they were', () => {
    expect(applyVisibleOrder(all, ['b', 'a', 'c', 'd'])).toEqual(['b', 'x', 'a', 'y', 'c', 'd']);
    expect(applyVisibleOrder(all, ['d', 'c', 'b', 'a'])).toEqual(['d', 'x', 'c', 'y', 'b', 'a']);
  });

  it('keeps every account exactly once', () => {
    const next = applyVisibleOrder(all, ['c', 'd', 'a', 'b']);
    expect([...next].sort()).toEqual([...all].sort());
  });
});
