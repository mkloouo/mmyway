// Settings → About and help: the app's version, when it last synced, and the activity log (which is
// where the log is shared or cleared).
import { useTranslation } from 'react-i18next';
import { ScrollView, Text } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
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
import whatsNew from '../../src/about/whatsNew.json';

export default function AboutScreen() {
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const { data: settings } = useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: () => loadSettings(db),
  });
  const lastSyncedAt = settings?.lastSyncedAt ?? null;
  const version = Constants.expoConfig?.version ?? '0.1.0';
  const valueText = (text: string) => (
    <Text style={[t.type.body, { color: t.color.textMuted }]}>{text}</Text>
  );

  return (
    <Screen>
      <PushHeader
        backLabel={tr('settings.title')}
        onBack={() => router.back()}
        title={tr('settings.aboutAndHelp')}
      />
      <ScrollView
        contentContainerStyle={{ paddingBottom: t.space.xxl, paddingTop: SCREEN_TOP_PADDING }}
      >
        <SectionHeader first title={tr('settings.sectionThisApp')} />
        <Card flush style={{ marginHorizontal: t.space.lg }}>
          <ListRow first label={tr('settings.version')} trailing={valueText(version)} />
          <ListRow
            label={tr('settings.lastSync')}
            trailing={valueText(relativeTime(lastSyncedAt))}
          />
          <ListRow
            label={tr('settings.whatsNewIn', { version: whatsNew.version })}
            chevron
            onPress={() => router.push('/settings/whats-new')}
          />
        </Card>

        <SectionHeader title={tr('settings.sectionWrong')} />
        <Card flush style={{ marginHorizontal: t.space.lg }}>
          <ListRow
            first
            label={tr('logs.title')}
            chevron
            onPress={() => router.push('/settings/logs')}
          />
        </Card>
        <GroupFooter>{tr('settings.logFooter')}</GroupFooter>
      </ScrollView>
    </Screen>
  );
}
