import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import {
  Card,
  FieldRow,
  ListRow,
  OptionTiles,
  SectionHeader,
  Segmented,
  SummaryCallout,
} from '../ui/kit';
import { TextField } from '../ui/TextField';
import { TimeRows } from '../ui/TimeRows';
import { pickDate } from '../ui/pickDate';
import { useTheme } from '../ui/theme';
import { TX_TYPES } from '../transactions/txTypes';
import { signFor, type DisplayCurrency } from '../money/format';
import { dayLabel, weekdayName, weekendName } from './labels';
import { movedOccurrenceLabel } from '../ui/ScheduleSummary';
import { localDay } from '../utils/day';
import type { PlannedFields } from './model';
import type { OpenSheet } from './usePlannedForm';

export function NewPlannedStep1({
  fields,
  changeType,
  set,
  setSheet,
  currency,
  fromText,
  toText,
  ownFrom,
  ownTo,
}: {
  fields: PlannedFields;
  changeType: (type: 'withdrawal' | 'deposit' | 'transfer') => void;
  set: (patch: Partial<PlannedFields>) => void;
  setSheet: (sheet: OpenSheet) => void;
  currency: DisplayCurrency | null;
  fromText: string;
  toText: string;
  ownFrom: boolean;
  ownTo: boolean;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();

  return (
    <>
      <Text
        style={[
          t.type.body,
          { color: t.color.textMuted, paddingHorizontal: t.space.xl, paddingTop: t.space.md },
        ]}
      >
        {tr('planned.new.question')}
      </Text>
      <View style={{ marginHorizontal: t.space.lg, marginTop: t.space.sm }}>
        <Segmented
          options={TX_TYPES.map((x) => ({ key: x.type, label: tr(x.labelKey) }))}
          value={fields.type}
          onChange={changeType}
          accessibilityLabel={tr('fields.type')}
        />
      </View>
      <Card style={{ marginHorizontal: t.space.lg, marginTop: t.space.md }}>
        <FieldRow first label={tr('planned.new.name')} labelWidth={92}>
          <TextField
            value={fields.name}
            onChangeText={(name) => set({ name })}
            placeholder={tr('planned.namePlaceholder')}
            style={{
              flex: 1,
              borderWidth: 0,
              paddingHorizontal: 0,
              paddingVertical: 0,
              textAlign: 'left',
              backgroundColor: 'transparent',
            }}
          />
        </FieldRow>
        <FieldRow label={tr('fields.amount')} labelWidth={92}>
          <TextField
            value={fields.amount === '0' ? '' : fields.amount}
            onChangeText={(val) => {
              const sanitized = val.replace(',', '.').trim();
              set({ amount: sanitized || '0' });
            }}
            placeholder="0"
            keyboardType="decimal-pad"
            accessibilityLabel={tr('fields.amount')}
            style={{
              flex: 1,
              borderWidth: 0,
              paddingHorizontal: 0,
              paddingVertical: 0,
              textAlign: 'right',
              backgroundColor: 'transparent',
              fontVariant: ['tabular-nums'],
            }}
          />
          <Pressable
            onPress={() => setSheet('currency')}
            accessibilityRole="button"
            accessibilityLabel={tr('fields.currency')}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 2, paddingLeft: 4 }}
          >
            <Text style={[t.type.body, { color: t.color.textMuted }]}>
              {currency?.symbol ?? fields.currencyCode}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={t.color.textFaint} />
          </Pressable>
        </FieldRow>
        <ListRow
          label={tr('fields.from')}
          value={fromText}
          chevron
          onPress={() => setSheet(ownFrom ? 'own' : 'payee')}
        />
        <ListRow
          label={tr('fields.to')}
          value={toText}
          chevron
          onPress={() => setSheet(ownTo ? 'ownTo' : 'payee')}
        />
        <ListRow
          label={tr('fields.category')}
          value={fields.categoryName ?? '—'}
          chevron
          onPress={() => setSheet('category')}
        />
      </Card>
      <Text
        style={[
          t.type.label,
          {
            color: t.color.textMuted,
            marginHorizontal: t.space.lg,
            marginTop: t.space.sm,
            paddingHorizontal: t.space.xs,
          },
        ]}
      >
        {tr('planned.new.amountHint')}
      </Text>
    </>
  );
}

export function NewPlannedStep2({
  fields,
  how,
  chooseHow,
  setScheduleOpen,
  moveDate,
  set,
  from,
  nextDays,
  scheduleText,
}: {
  fields: PlannedFields;
  how: 'once' | 'weekly' | 'monthly' | 'more';
  chooseHow: (key: 'once' | 'weekly' | 'monthly') => void;
  setScheduleOpen: (open: boolean) => void;
  moveDate: (date: string) => void;
  set: (patch: Partial<PlannedFields>) => void;
  from: string;
  nextDays: string[];
  scheduleText: string;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const first = fields.repetitions[0];

  const firstRepRowValue = () => {
    if (!first) return '—';
    if (first.type === 'monthly') {
      return tr('planned.new.theDay', { day: Number(first.moment) || 1 });
    }
    if (first.type === 'weekly') {
      return weekdayName(Number(first.moment) || 1);
    }
    if (first.type === 'daily') {
      return tr('planned.freqDaily');
    }
    if (first.type === 'yearly') {
      return dayLabel(first.moment || fields.date);
    }
    return first.moment || '—';
  };

  const firstRepRowLabel = () => {
    if (first?.type === 'weekly') return tr('planned.new.everyWeekOn');
    if (first?.type === 'monthly') return tr('planned.new.everyMonthOn');
    return tr('planned.repTypeLabel');
  };

  const endsRowValue = () => {
    if (fields.end.kind === 'forever') return tr('planned.end.forever');
    if (fields.end.kind === 'until') return dayLabel(fields.end.date);
    return tr('planned.endTimes', { count: fields.end.count });
  };

  return (
    <>
      <Text
        style={[
          t.type.body,
          { color: t.color.textMuted, paddingHorizontal: t.space.xl, paddingTop: t.space.md },
        ]}
      >
        {tr('planned.new.whenQuestion', { name: fields.name.trim() })}
      </Text>
      <SectionHeader title={tr('planned.repTypeLabel')} />
      <OptionTiles
        options={[
          { key: 'once', label: tr('planned.new.once') },
          { key: 'weekly', label: tr('planned.repType.weekly') },
          { key: 'monthly', label: tr('planned.repType.monthly') },
          { key: 'more', label: tr('planned.new.more') },
        ]}
        value={how}
        onChange={(key) => (key === 'more' ? setScheduleOpen(true) : chooseHow(key))}
        accessibilityLabel={tr('planned.repTypeLabel')}
        style={{ marginHorizontal: t.space.lg }}
      />

      <SectionHeader title={tr('planned.new.sectionStarting')} />
      <Card style={{ marginHorizontal: t.space.lg }}>
        <ListRow
          first
          label={tr('planned.new.firstTime')}
          value={dayLabel(fields.date)}
          chevron
          onPress={() =>
            pickDate(new Date(`${fields.date}T12:00:00`), (d) => moveDate(localDay(d)))
          }
        />
        <TimeRows time={fields.time} onChange={(time) => set({ time })} />
      </Card>

      {fields.repeats && (
        <>
          <SectionHeader title={tr('planned.new.sectionThen')} />
          <Card style={{ marginHorizontal: t.space.lg }}>
            <ListRow
              first
              label={firstRepRowLabel()}
              value={firstRepRowValue()}
              chevron
              onPress={() => setScheduleOpen(true)}
            />
            <ListRow
              label={tr('planned.new.onWeekend')}
              value={weekendName(first?.weekend ?? 1)}
              chevron
              onPress={() => setScheduleOpen(true)}
            />
            <ListRow
              label={tr('planned.new.sectionEnds')}
              value={endsRowValue()}
              chevron
              onPress={() => setScheduleOpen(true)}
            />
          </Card>
        </>
      )}

      <SummaryCallout
        title={scheduleText || tr('planned.once')}
        subtitle={
          nextDays.length > 0
            ? nextDays.map((d) => movedOccurrenceLabel(d, fields.repetitions, from)).join(' · ')
            : undefined
        }
        style={{ marginHorizontal: t.space.lg, marginTop: t.space.lg }}
      />
    </>
  );
}

export function NewPlannedStep3({
  fields,
  next,
  amountText,
  fromText,
  toText,
  scheduleText,
  firstLine,
  remindText,
  set,
  setSheet,
  setTagsSheetOpen,
}: {
  fields: PlannedFields;
  next: PlannedFields;
  amountText: string;
  fromText: string;
  toText: string;
  scheduleText: string;
  firstLine: string;
  remindText: string;
  set: (patch: Partial<PlannedFields>) => void;
  setSheet: (sheet: OpenSheet) => void;
  setTagsSheetOpen: (open: boolean) => void;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();

  return (
    <>
      <SummaryCallout
        title={tr('planned.new.summaryTitle', {
          name: next.name,
          amount: `${signFor(fields.type)}${amountText}`,
        })}
        subtitle={
          <>
            <Text style={[t.type.body, { color: t.color.text }]}>
              {tr('planned.new.summaryRoute', {
                schedule: scheduleText || tr('planned.once'),
                from: fromText,
                to: toText,
              })}
            </Text>
            <Text style={[t.type.label, { color: t.color.accentStrong }]}>{firstLine}</Text>
          </>
        }
        style={{ marginHorizontal: t.space.lg, marginTop: t.space.md }}
      />

      <SectionHeader title={tr('planned.new.sectionExtras')} />
      <Card style={{ marginHorizontal: t.space.lg }}>
        <FieldRow first label={tr('planned.new.note')} labelWidth={92}>
          <TextField
            value={fields.notes ?? ''}
            onChangeText={(notes) => set({ notes: notes || null })}
            placeholder={tr('planned.new.notePlaceholder')}
            style={{
              flex: 1,
              borderWidth: 0,
              paddingHorizontal: 0,
              paddingVertical: 0,
              textAlign: 'left',
              backgroundColor: 'transparent',
            }}
          />
        </FieldRow>
        <ListRow
          label={tr('fields.tags')}
          value={fields.tags.length ? fields.tags.join(', ') : tr('common.none')}
          chevron
          onPress={() => setTagsSheetOpen(true)}
        />
        <ListRow
          label={tr('planned.remind.title')}
          value={remindText}
          chevron
          onPress={() => setSheet('remind')}
        />
      </Card>

      <SectionHeader title={tr('planned.new.sectionSaved')} />
      <Card flush style={{ marginHorizontal: t.space.lg }}>
        <ListRow
          first
          label={tr('planned.new.savedAs')}
          subtitle={tr('planned.new.savedAsHint', { name: next.name })}
        />
      </Card>
    </>
  );
}
