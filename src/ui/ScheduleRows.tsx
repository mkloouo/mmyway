// The Planned tab's schedule editor: a list of repetitions with add/remove, and the end condition.
//
// One planned transaction can repeat on several patterns at once, as Firefly III holds them, so
// this is a list rather than a single frequency picker — which is also what stops a "1st and the
// 15th" recurrence built in FF3's web UI from losing the 15th on any edit here. Each row's
// `moment` follows from its type (a day of the month for monthly, a weekday for weekly, nth +
// weekday for ndom, a date for yearly, nothing at all for daily), not from the planned date.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { Button, Card, Row, SectionHeader } from './components';
import { PickerSheet } from './PickerSheet';
import { pickDate } from './pickDate';
import { useTheme } from './theme';
import {
  momentFor,
  ndomMoment,
  parseNdom,
  REPETITION_TYPES,
  WEEKEND_RULES,
  type EndCondition,
  type Repetition,
  type RepetitionType,
} from '../planned/repetition';
import { dayLabel, nthName, repetitionTypeName, weekdayName, weekendName } from '../planned/labels';
import { localDay } from '../utils/day';

type Sheet =
  { k: 'type' | 'weekday' | 'dayOfMonth' | 'nth' | 'weekend'; i: number } | { k: 'end' } | null;

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => String(from + i));

export function ScheduleRows({
  repetitions,
  end,
  date,
  onChange,
}: {
  repetitions: Repetition[];
  end: EndCondition;
  /** The planned date: what a new row and a switched type take their `moment` from. */
  date: string;
  onChange: (patch: { repetitions?: Repetition[]; end?: EndCondition }) => void;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const [sheet, setSheet] = useState<Sheet>(null);
  const open = sheet && sheet.k !== 'end' ? repetitions[sheet.i] : undefined;

  const patchRow = (index: number, patch: Partial<Repetition>) =>
    onChange({
      repetitions: repetitions.map((rep, i) => (i === index ? { ...rep, ...patch } : rep)),
    });

  /** Switching the type takes a `moment` the new type can hold; the old one means nothing to it. */
  const changeType = (index: number, type: RepetitionType) =>
    patchRow(index, { type, moment: momentFor(type, date) });

  return (
    <>
      <SectionHeader
        title={tr('planned.repetitionsLabel')}
        action={
          <Button
            title={tr('planned.repetitionAdd')}
            variant="secondary"
            onPress={() =>
              onChange({
                repetitions: [
                  ...repetitions,
                  { type: 'monthly', moment: momentFor('monthly', date), skip: 0, weekend: 1 },
                ],
              })
            }
          />
        }
      />
      {repetitions.map((rep, i) => (
        <Card key={i} style={{ marginHorizontal: t.space.lg, marginBottom: t.space.sm }}>
          <Row
            first
            label={tr('planned.repTypeLabel')}
            value={repetitionTypeName(rep.type)}
            chevron
            onPress={() => setSheet({ k: 'type', i })}
          />
          {rep.type === 'weekly' && (
            <Row
              label={tr('planned.weekdayLabel')}
              value={weekdayName(Number(rep.moment) || 1)}
              chevron
              onPress={() => setSheet({ k: 'weekday', i })}
            />
          )}
          {rep.type === 'monthly' && (
            <Row
              label={tr('planned.dayOfMonthLabel')}
              value={String(Number(rep.moment) || 1)}
              chevron
              onPress={() => setSheet({ k: 'dayOfMonth', i })}
            />
          )}
          {rep.type === 'ndom' && (
            <>
              <Row
                label={tr('planned.nthLabel')}
                value={nthName(parseNdom(rep.moment).nth)}
                chevron
                onPress={() => setSheet({ k: 'nth', i })}
              />
              <Row
                label={tr('planned.weekdayLabel')}
                value={weekdayName(parseNdom(rep.moment).weekday)}
                chevron
                onPress={() => setSheet({ k: 'weekday', i })}
              />
            </>
          )}
          {rep.type === 'yearly' && (
            <Row
              label={tr('planned.yearlyDateLabel')}
              value={dayLabel(rep.moment)}
              chevron
              onPress={() =>
                pickDate(new Date(`${rep.moment || date}T12:00:00`), (d) =>
                  patchRow(i, { moment: localDay(d) }),
                )
              }
            />
          )}
          <EveryRow type={rep.type} skip={rep.skip} onChange={(skip) => patchRow(i, { skip })} />
          <Row
            label={tr('planned.weekendLabel')}
            value={weekendName(rep.weekend)}
            chevron
            onPress={() => setSheet({ k: 'weekend', i })}
          />
          {repetitions.length > 1 && (
            <Row
              label={tr('planned.repetitionRemove')}
              icon="close-circle"
              tone="danger"
              onPress={() => onChange({ repetitions: repetitions.filter((_, x) => x !== i) })}
            />
          )}
        </Card>
      ))}

      <Card style={{ marginHorizontal: t.space.lg }}>
        <Row
          first
          label={tr('planned.endLabel')}
          value={tr(`planned.end.${end.kind}`)}
          chevron
          onPress={() => setSheet({ k: 'end' })}
        />
        {end.kind === 'until' && (
          <Row
            label={tr('planned.endDateLabel')}
            value={dayLabel(end.date)}
            chevron
            onPress={() =>
              pickDate(new Date(`${end.date}T12:00:00`), (d) =>
                onChange({ end: { kind: 'until', date: localDay(d) } }),
              )
            }
          />
        )}
        {end.kind === 'times' && (
          <Stepper
            label={tr('planned.endCountLabel')}
            value={Math.max(2, end.count)}
            min={2}
            onChange={(count) => onChange({ end: { kind: 'times', count } })}
          />
        )}
      </Card>

      <PickerSheet
        visible={sheet?.k === 'type'}
        onClose={() => setSheet(null)}
        title={tr('planned.repTypeLabel')}
        options={REPETITION_TYPES.map((type) => ({ key: type, label: repetitionTypeName(type) }))}
        selected={open?.type}
        onSelect={(key) => {
          const type = REPETITION_TYPES.find((x) => x === key);
          if (type && sheet && sheet.k !== 'end') changeType(sheet.i, type);
        }}
      />
      <PickerSheet
        visible={sheet?.k === 'weekday'}
        onClose={() => setSheet(null)}
        title={tr('planned.weekdayLabel')}
        options={range(1, 7).map((d) => ({ key: d, label: weekdayName(Number(d)) }))}
        selected={
          open ? String(open.type === 'ndom' ? parseNdom(open.moment).weekday : open.moment) : null
        }
        onSelect={(key) => {
          if (!key || !sheet || sheet.k === 'end' || !open) return;
          patchRow(
            sheet.i,
            open.type === 'ndom'
              ? { moment: ndomMoment(parseNdom(open.moment).nth, Number(key)) }
              : { moment: key },
          );
        }}
      />
      <PickerSheet
        visible={sheet?.k === 'dayOfMonth'}
        onClose={() => setSheet(null)}
        title={tr('planned.dayOfMonthLabel')}
        options={range(1, 31).map((d) => ({ key: d, label: d }))}
        selected={open ? String(Number(open.moment) || 1) : null}
        onSelect={(key) => {
          if (key && sheet && sheet.k !== 'end') patchRow(sheet.i, { moment: key });
        }}
      />
      <PickerSheet
        visible={sheet?.k === 'nth'}
        onClose={() => setSheet(null)}
        title={tr('planned.nthLabel')}
        options={range(1, 5).map((n) => ({ key: n, label: nthName(Number(n)) }))}
        selected={open ? String(parseNdom(open.moment).nth) : null}
        onSelect={(key) => {
          if (!key || !sheet || sheet.k === 'end' || !open) return;
          patchRow(sheet.i, { moment: ndomMoment(Number(key), parseNdom(open.moment).weekday) });
        }}
      />
      <PickerSheet
        visible={sheet?.k === 'weekend'}
        onClose={() => setSheet(null)}
        title={tr('planned.weekendLabel')}
        options={WEEKEND_RULES.map((w) => ({ key: String(w), label: weekendName(w) }))}
        selected={open ? String(open.weekend) : null}
        onSelect={(key) => {
          const weekend = WEEKEND_RULES.find((w) => String(w) === key);
          if (weekend && sheet && sheet.k !== 'end') patchRow(sheet.i, { weekend });
        }}
      />
      <PickerSheet
        visible={sheet?.k === 'end'}
        onClose={() => setSheet(null)}
        title={tr('planned.endLabel')}
        options={(['forever', 'until', 'times'] as const).map((kind) => ({
          key: kind,
          label: tr(`planned.end.${kind}`),
        }))}
        selected={end.kind}
        onSelect={(key) => {
          if (key === 'forever') onChange({ end: { kind: 'forever' } });
          // Both start from something valid, so Save is never blocked by an unset value.
          if (key === 'until') onChange({ end: { kind: 'until', date: inAYear(date) } });
          if (key === 'times') onChange({ end: { kind: 'times', count: 12 } });
        }}
      />
    </>
  );
}

/** A year after the planned date: where an "until" end condition starts, so it is always valid. */
function inAYear(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  d.setFullYear(d.getFullYear() + 1);
  return localDay(d);
}

/** "Every 2 months", as FF3's `skip` plus one. */
function EveryRow({
  type,
  skip,
  onChange,
}: {
  type: RepetitionType;
  skip: number;
  onChange: (skip: number) => void;
}) {
  const { t: tr } = useTranslation();
  return (
    <Stepper
      label={tr('planned.everyLabel')}
      value={skip + 1}
      min={1}
      max={32}
      format={(count) => tr(`planned.everyPeriod_${type}`, { count })}
      onChange={(every) => onChange(every - 1)}
    />
  );
}

function Stepper({
  label,
  value,
  min,
  max = 999,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max?: number;
  format?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space.md,
        paddingVertical: t.space.sm,
        borderTopWidth: 1,
        borderTopColor: t.color.border,
      }}
    >
      <Text style={[t.type.body, { color: t.color.textMuted, flex: 1 }]}>
        {`${label} ${format ? format(value) : value}`}
      </Text>
      <Button
        title="−"
        variant="secondary"
        onPress={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
      />
      <Button
        title="+"
        variant="secondary"
        onPress={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
      />
    </View>
  );
}
