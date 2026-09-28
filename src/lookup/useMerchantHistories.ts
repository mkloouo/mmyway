// Payee history for a screen's payee sheet, re-read when the entry's type changes. A lookup that
// lands after the type moved on (or the screen closed) is dropped, so the older one can't win.
import { useEffect, useState } from 'react';
import { useDb } from '../providers/DbProvider';
import { buildMerchantLookup, type MerchantHistory } from './merchantLookup';

export function useMerchantHistories(type: 'withdrawal' | 'deposit' | undefined, { enabled = true } = {}): MerchantHistory[] {
  const db = useDb();
  const [histories, setHistories] = useState<MerchantHistory[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    buildMerchantLookup(db, { type })
      .then((map) => { if (!cancelled) setHistories([...map.values()]); })
      .catch(() => undefined); // suggestions only: an empty list is the fallback
    return () => { cancelled = true; };
  }, [db, type, enabled]);
  return histories;
}
