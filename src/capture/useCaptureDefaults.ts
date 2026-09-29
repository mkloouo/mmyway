import { useEffect, useState } from 'react';
import { useDb } from '../providers/DbProvider';
import { getDefaultSourceAccountId, getDefaultCurrencyCode } from '../settings/appSettings';

export function useCaptureDefaults(): {
  defaultAccountId: string | null;
  defaultCurrencyCode: string | null;
} {
  const db = useDb();
  const [defaultAccountId, setDefaultAccountId] = useState<string | null>(null);
  const [defaultCurrencyCode, setDefaultCurrencyCode] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [accountId, currencyCode] = await Promise.all([
        getDefaultSourceAccountId(db),
        getDefaultCurrencyCode(db),
      ]);
      setDefaultAccountId(accountId);
      setDefaultCurrencyCode(currencyCode);
    })();
  }, [db]);

  return { defaultAccountId, defaultCurrencyCode };
}
