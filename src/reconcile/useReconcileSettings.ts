import { useEffect, useState } from 'react';
import { useDb } from '../providers/DbProvider';
import { logLine } from '../utils/log';
import { errorMessage } from '../utils/errorMessage';
import {
  getReconcileShortfallAccountId,
  getReconcileSurplusAccountId,
  getReconcileCategoryName,
} from '../settings/appSettings';

export function useReconcileSettings() {
  const db = useDb();
  const [shortfallAccountId, setShortfallAccountId] = useState<string | null>(null);
  const [surplusAccountId, setSurplusAccountId] = useState<string | null>(null);
  const [reconcileCategory, setReconcileCategory] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getReconcileShortfallAccountId(db),
      getReconcileSurplusAccountId(db),
      getReconcileCategoryName(db),
    ])
      .then(([sf, sp, cat]) => {
        if (cancelled) return;
        setShortfallAccountId(sf);
        setSurplusAccountId(sp);
        setReconcileCategory(cat);
      })
      .catch((err) => logLine('warn', `reconcile settings failed: ${errorMessage(err)}`));
    return () => {
      cancelled = true;
    };
  }, [db]);

  return {
    shortfallAccountId,
    setShortfallAccountId,
    surplusAccountId,
    setSurplusAccountId,
    reconcileCategory,
    setReconcileCategory,
  };
}
