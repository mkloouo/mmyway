// Settings → About and help: the app's version, when it last synced, activity log actions,
// and Firefly III section. (V4 board 31)
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, ScrollView, Text } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { e2eLinksEnabled } from '../../src/e2e/signInLink';
import { useDb } from '../../src/providers/DbProvider';
import { useTheme } from '../../src/ui/theme';
import {
  Card,
  GroupFooter,
  ListRow,
  PushHeader,
  SCREEN_TOP_PADDING,
  Screen,
  SectionHeader,
} from '../../src/ui/kit';
import { relativeTime } from '../../src/ui/relativeTime';
import { loadSettings, SETTINGS_QUERY_KEY } from '../../src/settings/loadSettings';
import { confirmAndClearLog, readLog, shareLog } from '../../src/utils/log';
import { useAction } from '../../src/ui/useAction';

export default function AboutScreen() {
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const act = useAction();
  const { data: settings } = useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: () => loadSettings(db),
  });

  const [logCount, setLogCount] = useState(() => readLog().length);
  useFocusEffect(
    useCallback(() => {
      setLogCount(readLog().length);
    }, []),
  );

  const lastSyncedAt = settings?.lastSyncedAt ?? null;
  const rawVersion = Constants.expoConfig?.version ?? '0.1.0';
  const buildNumber =
    Constants.expoConfig?.android?.versionCode ?? Constants.expoConfig?.ios?.buildNumber ?? null;
  const version = buildNumber ? `${rawVersion} (${buildNumber})` : rawVersion;
  const activeHost = settings?.ff3ActiveHost ?? settings?.ff3Hosts[0] ?? null;
  const ff3Version = settings?.ff3Version ?? null;

  const onShare = act(tr('logs.share'), async () => {
    await shareLog();
  });

  const onClear = act(tr('logs.clear'), async () => {
    if (await confirmAndClearLog()) {
      setLogCount(0);
    }
  });

  const onOpenBrowser = act(tr('settings.openInBrowser'), async () => {
    if (activeHost) await Linking.openURL(activeHost);
  });

  const valueText = (text: string) => (
    <Text style={[t.type.body, { color: t.color.textMuted }]}>{text}</Text>
  );

  return (
    <Screen bottom>
      <PushHeader backLabel={tr('settings.title')} onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={{ paddingBottom: t.space.xxl, paddingTop: SCREEN_TOP_PADDING }}
      >
        <Text
          style={[
            t.type.largeTitle,
            { color: t.color.text, paddingHorizontal: t.space.lg, paddingBottom: t.space.md },
          ]}
        >
          {tr('settings.aboutAndHelp')}
        </Text>

        {/* This app (board 31) */}
        <SectionHeader first title={tr('settings.sectionThisApp')} />
        <Card flush style={{ marginHorizontal: t.space.lg }}>
          <ListRow first label={tr('settings.version')} trailing={valueText(version)} />
          <ListRow
            label={tr('settings.lastSynced')}
            trailing={valueText(relativeTime(lastSyncedAt))}
          />
          <ListRow
            label={tr('settings.whatsNew')}
            chevron
            onPress={() => router.push('/settings/whats-new')}
          />
          {e2eLinksEnabled(Constants.expoConfig?.extra?.appVariant) && (
            <ListRow
              label={tr('settings.featureFlags')}
              chevron
              onPress={() => router.push('/settings/flags')}
            />
          )}
        </Card>

        {/* When something goes wrong (board 31) */}
        <SectionHeader title={tr('settings.sectionWrong')} />
        <Card flush style={{ marginHorizontal: t.space.lg }}>
          <ListRow
            first
            label={tr('logs.title')}
            sub={tr('logs.subtitle', { count: logCount })}
            chevron
            onPress={() => router.push('/settings/logs')}
          />
          <ListRow
            label={tr('logs.shareLog')}
            tone="accent"
            onPress={logCount > 0 ? onShare : undefined}
          />
          <ListRow
            label={tr('logs.clearLog')}
            tone={logCount > 0 ? 'danger' : 'default'}
            onPress={logCount > 0 ? onClear : undefined}
          />
        </Card>
        <GroupFooter>{tr('settings.logFooter')}</GroupFooter>

        {/* Firefly III (board 31) */}
        <SectionHeader title={tr('settings.sectionFireflyIii')} />
        <Card flush style={{ marginHorizontal: t.space.lg }}>
          <ListRow
            first
            label={tr('settings.openFireflyInBrowser')}
            tone="accent"
            chevron
            onPress={activeHost ? onOpenBrowser : undefined}
          />
          <ListRow
            label={tr('settings.ff3Version')}
            trailing={valueText(ff3Version ?? tr('settings.none'))}
          />
        </Card>
      </ScrollView>
    </Screen>
  );
}
