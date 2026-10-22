// Settings → About → Feature flags: Dev and preview build overrides for testing flags.
// Lists every flag in FLAG_NAMES with description, effective value, and source (default, Flagsmith, or override).
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { Redirect, router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { e2eLinksEnabled } from '../../src/e2e/signInLink';
import { FLAGS, FLAG_NAMES, type FlagName } from '../../src/flags/registry';
import { resolveFlag } from '../../src/flags/resolve';
import { FLAGS_QUERY_KEY } from '../../src/flags/useFlag';
import { useDb } from '../../src/providers/DbProvider';
import { getCachedFlags, getFlagOverrides, setFlagOverrides } from '../../src/settings/appSettings';
import { Button, Card, PushHeader, SCREEN_TOP_PADDING, Screen, SwitchRow } from '../../src/ui/kit';
import { useTheme } from '../../src/ui/theme';

export const FLAGS_ADMIN_QUERY_KEY = ['feature-flags-admin'] as const;

export default function FlagsScreen() {
  if (!e2eLinksEnabled(Constants.expoConfig?.extra?.appVariant)) {
    return <Redirect href="/" />;
  }
  return <FlagsList />;
}

function FlagsList() {
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: FLAGS_ADMIN_QUERY_KEY,
    queryFn: async () => ({
      cached: await getCachedFlags(db),
      overrides: await getFlagOverrides(db),
    }),
  });

  const cached = data?.cached ?? {};
  const overrides = data?.overrides ?? {};
  const hasOverrides = Object.keys(overrides).length > 0;

  const onToggle = async (name: FlagName, currentValue: boolean) => {
    const nextOverrides = { ...overrides, [name]: !currentValue };
    await setFlagOverrides(db, nextOverrides);
    await queryClient.invalidateQueries({ queryKey: FLAGS_QUERY_KEY });
    await queryClient.invalidateQueries({ queryKey: FLAGS_ADMIN_QUERY_KEY });
  };

  const onClearOverrides = async () => {
    await setFlagOverrides(db, {});
    await queryClient.invalidateQueries({ queryKey: FLAGS_QUERY_KEY });
    await queryClient.invalidateQueries({ queryKey: FLAGS_ADMIN_QUERY_KEY });
  };

  return (
    <Screen bottom>
      <PushHeader
        backLabel={tr('settings.aboutAndHelp')}
        onBack={() => router.back()}
        right={
          hasOverrides ? (
            <Button
              title={tr('flags.clearOverrides')}
              variant="ghost"
              size="bar"
              onPress={onClearOverrides}
            />
          ) : undefined
        }
      />
      <ScrollView
        contentContainerStyle={{ paddingBottom: t.space.xxl, paddingTop: SCREEN_TOP_PADDING }}
      >
        <Text
          style={[
            t.type.largeTitle,
            { color: t.color.text, paddingHorizontal: t.space.lg, paddingBottom: t.space.xs },
          ]}
        >
          {tr('flags.title')}
        </Text>
        <Text
          style={[
            t.type.body,
            { color: t.color.textMuted, paddingHorizontal: t.space.lg, paddingBottom: t.space.lg },
          ]}
        >
          {tr('flags.description')}
        </Text>

        <Card flush style={{ marginHorizontal: t.space.lg }}>
          {FLAG_NAMES.map((name, index) => {
            const isOverride = overrides[name] !== undefined;
            const isFlagsmith = !isOverride && cached[name] !== undefined;
            const sourceLabel = isOverride
              ? tr('flags.sourceOverride')
              : isFlagsmith
                ? tr('flags.sourceFlagsmith')
                : tr('flags.sourceDefault');
            const currentValue = resolveFlag(name, cached, overrides);
            const hint = `${FLAGS[name].description}\n${tr('flags.source', { source: sourceLabel })}`;

            return (
              <SwitchRow
                key={name}
                first={index === 0}
                label={name}
                hint={hint}
                value={currentValue}
                onValueChange={() => void onToggle(name, currentValue)}
              />
            );
          })}
        </Card>

        {hasOverrides && (
          <View style={{ paddingHorizontal: t.space.lg, paddingTop: t.space.lg }}>
            <Button
              title={tr('flags.clearOverrides')}
              variant="secondary"
              onPress={onClearOverrides}
            />
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
