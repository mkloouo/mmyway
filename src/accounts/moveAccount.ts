// Reorder with some accounts hidden (Settings → Accounts, inactive ones switched off): ▲/▼ moves
// an account past its neighbour *on screen*, and every hidden account keeps its place relative to
// the others — swapping by list index would have jumped over, or swapped with, accounts the user
// can't see.
export function moveAmongVisible(
  allIds: string[],
  visibleIds: string[],
  id: string,
  delta: -1 | 1,
): string[] | null {
  const at = visibleIds.indexOf(id);
  const neighbour = at < 0 ? undefined : visibleIds[at + delta];
  if (!neighbour) return null;
  const rest = allIds.filter((x) => x !== id);
  const neighbourAt = rest.indexOf(neighbour);
  if (neighbourAt < 0) return null;
  rest.splice(delta === -1 ? neighbourAt : neighbourAt + 1, 0, id);
  return rest;
}
