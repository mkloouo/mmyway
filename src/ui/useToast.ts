import { useEffect, useState } from 'react';

/** A message that clears itself after `ms` — pairs with <Toast message={toast} />. */
export function useToast(ms = 2000): [string | null, (message: string) => void] {
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), ms);
    return () => clearTimeout(timer);
  }, [toast, ms]);
  return [toast, setToast];
}
