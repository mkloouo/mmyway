import type { AccountPickerAccount } from '../ui/AccountPickerSheet';

// The chip row shows a handful of choices, not a wall — the rest live behind the 🔍 button's
// AccountPickerSheet. A selection outside that handful still needs to be visible, so it's pinned
// first rather than left unrepresented in the row.
export function topChips<T extends AccountPickerAccount>(
  accounts: T[],
  selectedId: string | null | undefined,
  limit = 5,
): T[] {
  const top = accounts.slice(0, limit);
  if (selectedId) {
    const selected = accounts.find((a) => a.id === selectedId);
    if (selected) {
      const rest = top.filter((a) => a.id !== selectedId);
      return [selected, ...rest.slice(0, limit - 1)];
    }
  }
  return top;
}
