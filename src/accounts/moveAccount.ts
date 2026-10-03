// Reorder with some accounts hidden (Settings → Accounts, inactive ones switched off): the drag
// rearranges only the accounts on screen, and each hidden account keeps the slot it had in the
// full list — reordering by list index would have dragged accounts the user can't see along with
// it.
export function applyVisibleOrder(allIds: string[], newVisibleOrder: string[]): string[] {
  const queue = [...newVisibleOrder];
  const visible = new Set(newVisibleOrder);
  return allIds.map((id) => (visible.has(id) ? queue.shift()! : id));
}
