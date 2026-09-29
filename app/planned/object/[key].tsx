// The detailed view of one subscription, rule or recurring transaction: everything FF3 sent for
// it, read-only. Nested lists (a rule's triggers and actions, a recurrence's repetitions and
// transactions) are shown as sections of their own.
import { useTranslation } from 'react-i18next';
import { ScrollView, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTheme } from '../../../src/ui/theme';
import { Screen, AppBar, Card, Row, SectionHeader, CloseButton } from '../../../src/ui/components';
import { usePlanned } from '../../../src/planned/usePlanned';

const KIND_LABEL_KEYS = {
  bill: 'planned.subscription',
  rule: 'planned.rule',
  recurrence: 'planned.recurringOne',
} as const;

function isScalar(value: unknown): value is string | number | boolean | null | undefined {
  return (
    value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value)
  );
}

function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.every(isScalar) ? value.map(show).join(', ') || '—' : '';
  return String(value);
}

/** "next_expected_match" -> "Next expected match". */
function label(key: string): string {
  const words = key.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function Fields({ value, title }: { value: Record<string, unknown>; title?: string }) {
  const t = useTheme();
  const entries = Object.entries(value);
  const scalars = entries.filter(([, v]) => isScalar(v) || (Array.isArray(v) && v.every(isScalar)));
  const nested = entries.filter(
    ([, v]) => !(isScalar(v) || (Array.isArray(v) && v.every(isScalar))),
  );
  return (
    <>
      {!!title && <SectionHeader title={title} />}
      {scalars.length > 0 && (
        <Card style={{ marginHorizontal: t.space.lg }}>
          {scalars.map(([k, v], i) => (
            <Row key={k} first={i === 0} label={label(k)} value={show(v)} />
          ))}
        </Card>
      )}
      {nested.map(([k, v]) => {
        if (Array.isArray(v)) {
          return v.map((entry, i) =>
            entry && typeof entry === 'object' ? (
              <Fields
                key={`${k}-${i}`}
                value={entry as Record<string, unknown>}
                title={`${label(k)} ${i + 1}`}
              />
            ) : null,
          );
        }
        return v && typeof v === 'object' ? (
          <Fields key={k} value={v as Record<string, unknown>} title={label(k)} />
        ) : null;
      })}
    </>
  );
}

export default function PlannedObjectScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const { objects, loaded } = usePlanned();
  const object = objects.find((o) => o.key === key);

  return (
    <Screen bottom>
      <AppBar
        title={object?.name || tr('planned.title')}
        subtitle={object ? tr(KIND_LABEL_KEYS[object.kind]) : undefined}
        left={<CloseButton onPress={() => router.back()} />}
      />
      <ScrollView contentContainerStyle={{ paddingBottom: t.space.xxl }}>
        {object ? (
          <Fields value={{ id: object.id, ...object.attributes }} />
        ) : loaded ? (
          <Text style={[t.type.body, { color: t.color.textMuted, padding: t.space.lg }]}>
            {tr('planned.gone')}
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
