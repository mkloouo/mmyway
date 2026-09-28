import { moveAmongVisible } from './moveAccount';

// a, b, c, d in FF3 order; x and y are inactive and hidden.
const all = ['a', 'x', 'b', 'y', 'c', 'd'];
const visible = ['a', 'b', 'c', 'd'];

describe('moveAmongVisible', () => {
  it('with nothing hidden, swaps with the neighbour', () => {
    expect(moveAmongVisible(['a', 'b', 'c'], ['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveAmongVisible(['a', 'b', 'c'], ['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
  });

  it('moves past the visible neighbour, never swapping with a hidden account', () => {
    expect(moveAmongVisible(all, visible, 'b', -1)).toEqual(['b', 'a', 'x', 'y', 'c', 'd']);
    expect(moveAmongVisible(all, visible, 'b', 1)).toEqual(['a', 'x', 'y', 'c', 'b', 'd']);
  });

  it('keeps hidden accounts in their order relative to each other', () => {
    const next = moveAmongVisible(all, visible, 'c', -1)!;
    expect(next.filter((id) => id === 'x' || id === 'y')).toEqual(['x', 'y']);
    expect(next.filter((id) => visible.includes(id))).toEqual(['a', 'c', 'b', 'd']);
  });

  it('does nothing at either end of the visible list', () => {
    expect(moveAmongVisible(all, visible, 'a', -1)).toBeNull();
    expect(moveAmongVisible(all, visible, 'd', 1)).toBeNull();
    expect(moveAmongVisible(all, visible, 'x', 1)).toBeNull();
  });
});
