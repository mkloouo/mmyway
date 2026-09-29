// Multi-select on a list (long-press a card): the Inbox and Activity both do bulk actions this way.
// `leavingIds` is what a card reads to fold away (Collapsible) before it leaves the list.
import { useCallback, useState } from 'react';

export function useSelection() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [leavingIds, setLeavingIds] = useState<Set<string>>(new Set());

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  return {
    selectedIds,
    /** True while anything is selected: a tap then toggles instead of opening. */
    selecting: selectedIds.size > 0,
    toggleSelected,
    clearSelection,
    leavingIds,
    setLeavingIds,
  } as const;
}
