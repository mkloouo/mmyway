import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Card, ListRow, RadioRow, SectionHeader, Segmented, StepperRow } from './kit';
import { SchedulePickers, type PickerKind } from './SchedulePickers';
import { pickDate, pickTime } from './pickDate';
import { useTheme } from './theme';
import type { EndCondition, Repetition, RepetitionType } from '../planned/repetition';
import { momentFor, ndomMoment, parseNdom } from '../planned/repetition';
import { dayLabel, nthName, repetitionTypeName, weekdayName, weekendName } from '../planned/labels';
import { dayDate, localDay } from '../utils/day';

export interface ScheduleRowsProps {
  repeats: boolean;
  repetitions: Repetition[];
  end: EndCondition;
  date: string;
  time?: string | null;
  onChange: (patch: {
    date?: string;
    time?: string | null;
    repeats?: boolean;
    repetitions?: Repetition[];
    end?: EndCondition;
  }) => void;
}

export function inAYear(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  d.setFullYear(d.getFullYear() + 1);
  return localDay(d);
}

export function ScheduleRows({
  repeats,
  repetitions,
  end,
  date,
  time,
  onChange,
}: ScheduleRowsProps) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const [pickerKind, setPickerKind] = useState<PickerKind>(null);
  const [pickerIndex, setPickerIndex] = useState<number>(0);

  const first = repetitions[0];
  const currentFreq = !repeats
    ? 'once'
    : first?.type === 'daily'
      ? 'daily'
      : first?.type === 'weekly'
        ? 'weekly'
        : first?.type === 'yearly'
          ? 'yearly'
          : 'monthly';

  function chooseFreq(key: string) {
    if (key === 'once') {
      onChange({ repeats: false });
      return;
    }
    const type: RepetitionType =
      key === 'daily'
        ? 'daily'
        : key === 'weekly'
          ? 'weekly'
          : key === 'yearly'
            ? 'yearly'
            : 'monthly';
    const weekend = first?.weekend ?? 1;
    const skip = first?.skip ?? 0;
    onChange({
      repeats: true,
      repetitions: [{ type, moment: momentFor(type, date), skip, weekend }],
    });
  }

  function patchRow(index: number, patch: Partial<Repetition>) {
    onChange({
      repetitions: repetitions.map((rep, i) => (i === index ? { ...rep, ...patch } : rep)),
    });
  }

  function patchFirst(patch: Partial<Repetition>) {
    if (!first) return;
    patchRow(0, patch);
  }

  function moveDate(next: string) {
    const simple = repetitions.length === 1 && !!first;
    onChange({
      date: next,
      ...(simple ? { repetitions: [{ ...first, moment: momentFor(first.type, next) }] } : {}),
    });
  }

  // Monthly: day-of-month or ndom calculations
  const dayOfMonth =
    first?.type === 'monthly'
      ? Number(first.moment) || dayDate(date).getDate()
      : dayDate(date).getDate();
  const ndom =
    first?.type === 'ndom' ? parseNdom(first.moment) : parseNdom(momentFor('ndom', date));

  // Unit label for StepperRow
  const unitLabel = (type: RepetitionType, count: number): string => {
    switch (type) {
      case 'daily':
        return count === 1
          ? tr('planned.everyPeriod_daily_one')
          : tr('planned.everyPeriod_daily_other', { count });
      case 'weekly':
        return count === 1
          ? tr('planned.everyPeriod_weekly_one')
          : tr('planned.everyPeriod_weekly_other', { count });
      case 'yearly':
        return count === 1
          ? tr('planned.everyPeriod_yearly_one')
          : tr('planned.everyPeriod_yearly_other', { count });
      case 'monthly':
      case 'ndom':
      default:
        return count === 1
          ? tr('planned.everyPeriod_monthly_one')
          : tr('planned.everyPeriod_monthly_other', { count });
    }
  };

  return (
    <>
      <SectionHeader title={tr('planned.starts')} />
      <Card style={{ marginBottom: t.space.sm }}>
        <ListRow
          first
          label={tr('planned.firstDate')}
          value={dayLabel(date)}
          chevron
          onPress={() => pickDate(new Date(`${date}T12:00:00`), (d) => moveDate(localDay(d)))}
        />
        <ListRow
          label={tr('planned.time')}
          value={time ?? tr('planned.anyTime')}
          chevron
          onPress={() => pickTime(time ?? null, (newTime) => onChange({ time: newTime }))}
        />
        {!!time && (
          <ListRow
            label={tr('planned.clearTime')}
            icon="close-circle"
            tone="danger"
            onPress={() => onChange({ time: null })}
          />
        )}
      </Card>

      <SectionHeader title={tr('planned.repeats')} />
      <Card style={{ marginBottom: t.space.sm }}>
        <View style={{ paddingHorizontal: t.space.md, paddingVertical: t.space.xs }}>
          <Segmented
            options={[
              { key: 'once', label: tr('planned.freqOnce') },
              { key: 'daily', label: tr('planned.freqDaily') },
              { key: 'weekly', label: tr('planned.freqWeekly') },
              { key: 'monthly', label: tr('planned.freqMonthly') },
              { key: 'yearly', label: tr('planned.freqYearly') },
            ]}
            value={currentFreq}
            onChange={chooseFreq}
            accessibilityLabel={tr('planned.repeats')}
          />
        </View>

        {repeats && !!first && (
          <>
            <StepperRow
              label={tr('planned.everyLabel')}
              value={(first.skip ?? 0) + 1}
              min={1}
              max={32}
              unit={unitLabel(first.type, (first.skip ?? 0) + 1)}
              onChange={(count) => patchFirst({ skip: count - 1 })}
            />

            {(first.type === 'monthly' || first.type === 'ndom') && (
              <>
                <RadioRow
                  label={tr('planned.onDayOfMonth', { day: dayOfMonth })}
                  selected={first.type === 'monthly'}
                  chevron
                  onPress={() => {
                    if (first.type !== 'monthly') {
                      patchFirst({ type: 'monthly', moment: String(dayOfMonth) });
                    } else {
                      setPickerIndex(0);
                      setPickerKind('dayOfMonth');
                    }
                  }}
                />
                <RadioRow
                  label={tr('planned.onNdom', {
                    nth: nthName(ndom.nth),
                    weekday: weekdayName(ndom.weekday),
                  })}
                  selected={first.type === 'ndom'}
                  chevron
                  onPress={() => {
                    if (first.type !== 'ndom') {
                      patchFirst({
                        type: 'ndom',
                        moment: ndomMoment(ndom.nth, ndom.weekday),
                      });
                    } else {
                      setPickerIndex(0);
                      setPickerKind('weekday');
                    }
                  }}
                />
              </>
            )}

            {first.type === 'weekly' && (
              <ListRow
                label={tr('planned.weekdayLabel')}
                value={weekdayName(Number(first.moment) || 1)}
                chevron
                onPress={() => {
                  setPickerIndex(0);
                  setPickerKind('weekday');
                }}
              />
            )}

            {first.type === 'yearly' && (
              <ListRow
                label={tr('planned.yearlyDateLabel')}
                value={dayLabel(first.moment || date)}
                chevron
                onPress={() =>
                  pickDate(new Date(`${first.moment || date}T12:00:00`), (d) =>
                    patchFirst({ moment: localDay(d) }),
                  )
                }
              />
            )}

            <ListRow
              label={tr('planned.ifFallsOnWeekend')}
              value={weekendName(first.weekend)}
              chevron
              onPress={() => {
                setPickerIndex(0);
                setPickerKind('weekend');
              }}
            />

            <ListRow
              label={tr('planned.addAnotherPattern')}
              tone="accent"
              onPress={() =>
                onChange({
                  repetitions: [
                    ...repetitions,
                    { type: 'monthly', moment: momentFor('monthly', date), skip: 0, weekend: 1 },
                  ],
                })
              }
            />
          </>
        )}
      </Card>

      {repeats && repetitions.length > 1 && (
        <>
          <SectionHeader title={tr('planned.repetitionsLabel')} />
          {repetitions.slice(1).map((rep, extraIndex) => {
            const actualIndex = extraIndex + 1;
            return (
              <Card key={actualIndex} style={{ marginBottom: t.space.sm }}>
                <ListRow
                  first
                  label={tr('planned.repTypeLabel')}
                  value={repetitionTypeName(rep.type)}
                  chevron
                  onPress={() => {
                    setPickerIndex(actualIndex);
                    setPickerKind('repType');
                  }}
                />
                <StepperRow
                  label={tr('planned.everyLabel')}
                  value={(rep.skip ?? 0) + 1}
                  min={1}
                  max={32}
                  unit={unitLabel(rep.type, (rep.skip ?? 0) + 1)}
                  onChange={(count) => patchRow(actualIndex, { skip: count - 1 })}
                />
                <ListRow
                  label={tr('planned.repetitionRemove')}
                  icon="close-circle"
                  tone="danger"
                  onPress={() =>
                    onChange({
                      repetitions: repetitions.filter((_, x) => x !== actualIndex),
                    })
                  }
                />
              </Card>
            );
          })}
        </>
      )}

      {repeats && (
        <>
          <SectionHeader title={tr('planned.endLabel')} />
          <Card style={{ marginBottom: t.space.sm }}>
            <RadioRow
              first
              label={tr('planned.end.forever')}
              selected={end.kind === 'forever'}
              onPress={() => onChange({ end: { kind: 'forever' } })}
            />
            <RadioRow
              label={tr('planned.end.until')}
              selected={end.kind === 'until'}
              onPress={() =>
                onChange({
                  end: { kind: 'until', date: end.kind === 'until' ? end.date : inAYear(date) },
                })
              }
            />
            {end.kind === 'until' && (
              <ListRow
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
            <RadioRow
              label={tr('planned.end.times')}
              selected={end.kind === 'times'}
              onPress={() =>
                onChange({
                  end: { kind: 'times', count: end.kind === 'times' ? end.count : 12 },
                })
              }
            />
            {end.kind === 'times' && (
              <StepperRow
                label={tr('planned.endCountLabel')}
                value={Math.max(2, end.count)}
                min={2}
                max={999}
                onChange={(count) => onChange({ end: { kind: 'times', count } })}
              />
            )}
          </Card>
        </>
      )}

      {/* Picker sheets */}
      <SchedulePickers
        pickerKind={pickerKind}
        onClose={() => setPickerKind(null)}
        pickerIndex={pickerIndex}
        dayOfMonth={dayOfMonth}
        repetitions={repetitions}
        date={date}
        patchRow={patchRow}
      />
    </>
  );
}
