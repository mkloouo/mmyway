// The app lock's overlay. Mounted once by app/_layout.tsx, like LocaleSync: it covers everything
// (tabs and modals alike) while locked, rather than remounting the navigator and losing its state.
//
// The decision of whether to be locked lives in ./appLock.ts and is tested there; this file is the
// wiring — the setting, AppState, the prompt, and what the user sees meanwhile.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { eq } from 'drizzle-orm';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useDb } from '../providers/DbProvider';
import { useLiveQuery } from '../db/useLiveQuery';
import { appSettings } from '../db/schema';
import { APP_LOCK_ENABLED_KEY } from '../settings/appSettings';
import { Button } from '../ui/components';
import { useTheme } from '../ui/theme';
import { authenticate, canUseAppLock, shouldLock } from './appLock';

export function LockGate() {
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const { data: rows } = useLiveQuery(
    db.select().from(appSettings).where(eq(appSettings.key, APP_LOCK_ENABLED_KEY)),
  );
  const enabled = rows?.[0]?.value === '1';

  const [locked, setLocked] = useState(false);
  const [prompting, setPrompting] = useState(false);
  /** Epoch ms of the last unlock. In memory on purpose — see ./appLock.ts. */
  const unlockedAt = useRef<number | null>(null);
  const capable = useRef(false);
  const settled = useRef(false);
  /** Guards re-entry without making `unlock` change identity on every prompt. */
  const promptingRef = useRef(false);

  const unlock = useCallback(async () => {
    if (promptingRef.current) return;
    promptingRef.current = true;
    setPrompting(true);
    try {
      if (await authenticate(tr('lock.prompt'))) {
        unlockedAt.current = Date.now();
        setLocked(false);
      }
    } finally {
      promptingRef.current = false;
      setPrompting(false);
    }
  }, [tr]);

  // Raising the overlay and asking are one action, done from whatever decided to lock — rather
  // than from an effect watching `locked`, which would be a setState inside an effect body.
  const lockNow = useCallback(() => {
    setLocked(true);
    void unlock();
  }, [unlock]);

  // First answer from the settings query decides what launching means. Enabled at launch -> no
  // unlock on record -> locked. Disabled at launch -> record an unlock now, so that turning the
  // lock on from Settings a moment later doesn't lock the screen out from under the user; it
  // takes hold on the next launch or on a long enough trip to the background.
  useEffect(() => {
    if (settled.current || rows === undefined) return;
    settled.current = true;
    void canUseAppLock().then((ok) => {
      capable.current = ok;
      if (!enabled || !ok) {
        unlockedAt.current = Date.now();
        return;
      }
      lockNow();
    });
  }, [rows, enabled, lockNow]);

  // Coming back to the foreground after long enough locks again.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !capable.current) return;
      if (shouldLock({ enabled, lastUnlockedAt: unlockedAt.current, now: Date.now() })) lockNow();
    });
    return () => subscription.remove();
  }, [enabled, lockNow]);

  if (!locked) return null;

  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: t.color.bg,
          alignItems: 'center',
          justifyContent: 'center',
          gap: t.space.lg,
          padding: t.space.xxl,
        },
      ]}
      // Nothing behind this is reachable while it is up.
      accessibilityViewIsModal
    >
      <Ionicons name="lock-closed" size={48} color={t.color.textFaint} />
      <Text style={[t.type.heading, { color: t.color.text, textAlign: 'center' }]}>
        {tr('lock.title')}
      </Text>
      <Text style={[t.type.body, { color: t.color.textMuted, textAlign: 'center' }]}>
        {tr('lock.hint')}
      </Text>
      <Button title={tr('lock.unlock')} onPress={() => void unlock()} disabled={prompting} />
    </View>
  );
}
