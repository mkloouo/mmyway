// "The splits don't add up to the total any more" — the rule both editing screens follow after a
// typed amount, a removed split or a changed total: split 1 takes the difference (split 2, if
// split 1 is the one that was just typed), and only when it can't are the sliders asked for.
// The screens differ in how they write the result, so they hand `write` and `ask` in.
import { absorb, leftover } from './allocate';

export interface LeftoverHandlers {
  /** Split 1 (or the first that can) took the difference: these are the new amounts. */
  write: (amounts: string[]) => void;
  /** Nothing could absorb it: open the sliders for `delta`, leaving `exclude` alone. */
  ask: (delta: bigint, exclude?: number) => void;
}

export function placeLeftover(
  amounts: string[],
  total: string,
  decimalPlaces: number,
  handlers: LeftoverHandlers,
  exclude?: number,
): void {
  const delta = leftover(total, amounts, decimalPlaces);
  if (delta === 0n || amounts.length < 2) return;
  const absorbed = absorb(amounts, delta, decimalPlaces, exclude);
  if (absorbed) handlers.write(absorbed);
  else handlers.ask(delta, exclude);
}

/** The Reassign button: always the sliders, whatever split 1 could have taken. */
export function askLeftover(
  amounts: string[],
  total: string,
  decimalPlaces: number,
  ask: LeftoverHandlers['ask'],
): void {
  const delta = leftover(total, amounts, decimalPlaces);
  if (delta !== 0n && amounts.length > 1) ask(delta);
}
