import { useEffect } from 'react';
import { eq } from 'drizzle-orm';
import i18n, { resolveDeviceLanguage } from '.';
import { useDb } from '../providers/DbProvider';
import { useLiveQuery } from '../db/useLiveQuery';
import { appSettings } from '../db/schema';
import { LOCALE_KEY, parseLocale } from '../settings/appSettings';

// Applies the language picked in Settings, or follows the device language when it's left on
// "system". Rendered once inside DbProvider; the live query picks up a change made on the Settings
// screen and the stored value once the first read lands.
export function LocaleSync() {
  const db = useDb();
  const { data } = useLiveQuery(
    db.select().from(appSettings).where(eq(appSettings.key, LOCALE_KEY)),
  );
  const locale = parseLocale(data?.[0]?.value);

  useEffect(() => {
    const target = locale === 'system' ? resolveDeviceLanguage() : locale;
    if (i18n.language !== target) void i18n.changeLanguage(target);
  }, [locale]);

  return null;
}
