// Capture's keypad sized to the window it's in. Pure.
import { hitSize } from '../ui/theme';

/**
 * The keypad's key height. Keys used to be sized from the width alone (1.4:1), so a window short
 * for its width — pop-up, split screen, landscape — got a keypad taller than it had room for and
 * the bottom was cut off. Now the four rows take at most ~42% of the window's height, and a key is
 * never under the kit's touch size.
 */
export function captureKeyHeight(window: { width: number; height: number }): number {
  const margin = 8; // Keypad's 4 dp on each side of a key
  const byWidth = (window.width / 4 - margin) / 1.4;
  const byHeight = (window.height * 0.42) / 4 - margin;
  return Math.max(hitSize, Math.round(Math.min(byWidth, byHeight)));
}
