// Settings → Planned in Firefly III: the subscriptions, rules and recurring transactions as Firefly
// III holds them, read-only. Each one opens its detail page (app/planned/object/[key].tsx).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '../../src/ui/theme';
import { Screen, Card, EmptyState, SCREEN_TOP_PADDING } from '../../src/ui/components';
import { ListRow, PushHeader, Segmented } from '../../src/ui/kit';
import { usePlanned } from '../../src/planned/usePlanned';
import { objectSummary } from '../../src/planned/labels';
import type { PlannedKind } from '../../src/planned/objects';

const KINDS: { key: PlannedKind; labelKey: string }[] = [
  { key: 'bill', labelKey: 'planned.subscriptions' },
  { key: 'rule', labelKey: 'planned.rules' },
  { key: 'recurrence', labelKey: 'planned.recurring' },
];

export default function PlannedRawScreen() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const { objects, loaded } = usePlanned();
  const [kind, setKind] = useState<PlannedKind>('bill');
  const ofKind = objects
    .filter((o) => o.kind === kind)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Screen bottom>
      <PushHeader
        backLabel={tr('settings.title')}
        onBack={() => router.back()}
        title={tr('settings.plannedRaw')}
      />
      <ScrollView
        contentContainerStyle={{ paddingTop: SCREEN_TOP_PADDING, paddingBottom: t.space.xxl }}
      >
        <View style={{ paddingHorizontal: t.space.lg }}>
          <Segmented
            options={KINDS.map((k) => ({ key: k.key, label: tr(k.labelKey) }))}
            value={kind}
            onChange={setKind}
            accessibilityLabel={tr('settings.plannedRaw')}
          />
        </View>
        {ofKind.length > 0 && (
          <View style={{ paddingHorizontal: t.space.lg, paddingTop: t.space.lg }}>
            <Card flush>
              {ofKind.map((object, i) => (
                <ListRow
                  key={object.key}
                  first={i === 0}
                  label={object.name || '—'}
                  sub={objectSummary(object)}
                  chevron
                  onPress={() =>
                    router.push({ pathname: '/planned/object/[key]', params: { key: object.key } })
                  }
                />
              ))}
            </Card>
          </View>
        )}
        {loaded && ofKind.length === 0 && (
          <EmptyState glyph="◷" title={tr('planned.noneOfKind')} hint={tr('planned.emptyHint')} />
        )}
      </ScrollView>
    </Screen>
  );
}
