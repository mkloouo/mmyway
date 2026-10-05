// Where a dragged row lands, for DragList. Rows are not all one height (a row with a chip is
// taller), so both answers are sums of the real measured heights rather than a row count times
// one. Pure and worklet-safe: the gesture and every row's animated style call them on the UI
// thread.

/** Where the dragged row's top ends up, relative to where it started, if it lands at `to`. */
export function slotOf(from: number, to: number, heights: readonly number[]): number {
  'worklet';
  let y = 0;
  // Down: it takes the bottom of the block it passed, so it travels those rows' heights...
  for (let i = from + 1; i <= to; i++) y += heights[i] ?? 0;
  // ...and up: it takes the top, travelling back over every row it passed.
  for (let i = to; i < from; i++) y -= heights[i] ?? 0;
  return y;
}

/** The slot a row dragged `y` from `from` lands in: whichever slot it has come nearest to. */
export function landsAt(from: number, heights: readonly number[], y: number): number {
  'worklet';
  if (heights.length === 0) return from;
  const step = y < 0 ? -1 : 1;
  let to = from;
  let best = Math.abs(y);
  let travelled = 0;
  for (let i = from + step; i >= 0 && i < heights.length; i += step) {
    travelled += step * (heights[i] ?? 0);
    const distance = Math.abs(y - travelled);
    // Past the nearest slot: every one further is further still.
    if (distance >= best) break;
    best = distance;
    to = i;
  }
  return to;
}
