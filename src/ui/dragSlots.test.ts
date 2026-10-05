import { landsAt, slotOf } from './dragSlots';

// A list where one row is taller than the rest — an account with an "Envelope" chip.
const heights = [100, 100, 160, 100, 100];

describe('dragSlots', () => {
  it('travels the real heights of the rows it passes', () => {
    expect(slotOf(1, 1, heights)).toBe(0);
    expect(slotOf(1, 3, heights)).toBe(260);
    expect(slotOf(3, 1, heights)).toBe(-260);
    expect(slotOf(0, 4, heights)).toBe(460);
    expect(slotOf(4, 0, heights)).toBe(-460);
  });

  it('lands in the slot it has come nearest to', () => {
    expect(landsAt(1, heights, 0)).toBe(1);
    expect(landsAt(1, heights, 40)).toBe(1);
    // Past half of the taller row below, not half of a nominal row.
    expect(landsAt(1, heights, 70)).toBe(1);
    expect(landsAt(1, heights, 90)).toBe(2);
    expect(landsAt(1, heights, 260)).toBe(3);
    expect(landsAt(3, heights, -260)).toBe(1);
    // Never off either end.
    expect(landsAt(1, heights, -9999)).toBe(0);
    expect(landsAt(1, heights, 9999)).toBe(4);
    expect(landsAt(2, [], 500)).toBe(2);
  });
});
