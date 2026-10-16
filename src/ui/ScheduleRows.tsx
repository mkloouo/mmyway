// The Planned tab's schedule: one sheet with how often it repeats, the first date, when it stops,
// and — under "More…" — the repetitions themselves.
//
// One planned transaction can repeat on several patterns at once, as Firefly III holds them, so
// "More…" is a list of repetitions rather than a single frequency picker — which is also what stops
// a "1st and the 15th" recurrence built in FF3's web UI from losing the 15th on any edit here. Each
// row's `moment` follows from its type (a day of the month for monthly, a weekday for weekly, nth +
// weekday for ndom, a date for yearly, nothing at all for daily), not from the planned date.
//
// A choice opens as a list inside the same sheet (`choose`), never as a second sheet.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button, Card, ListRow, SectionHeader, Sheet } from './kit';
import { pickDate } from './pickDate';
import { useTheme } from './theme';
import { expandRepetition, upcomingOccurrences, withWeekendRule } from '../planned/occurrences';
import type { PlannedGroup } from '../planned/model';
import {
  momentFor,
  ndomMoment,
  parseNdom,
  REPETITION_TYPES,
  WEEKEND_RULES,
  type EndCondition,
  type Repetition,
  type RepetitionType,
  type WeekendRule,
} from '../planned/repetition';
import {
  dayLabel,
  endLabel,
  nthName,
  occurrenceLabel,
  repetitionTypeName,
  scheduleLabel,
  weekdayName,
  weekendName,
} from '../planned/labels';
import { localDay } from '../utils/day';

/** A single-choice list, shown in place of the sheet's content until one is picked. */
interface Choice {
  title: string;
  options: { key: string; label: string }[];
  selected: string | null;
  onSelect: (key: string) => void;
}

type Choose = (choice: Choice) => void;

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => String(from + i));

function weekendChoice(
  title: string,
  selected: WeekendRule,
  onSelect: (weekend: WeekendRule) => void,
): Choice {
  return {
    title,
    options: WEEKEND_RULES.map((w) => ({ key: String(w), label: weekendName(w) })),
    selected: String(selected),
    onSelect: (key) => {
      const weekend = WEEKEND_RULES.find((w) => String(w) === key);
      if (weekend) onSelect(weekend);
    },
  };
}

/** The sheet's schedule: the simple how-often choice, or the full list under "More…". */
export function ScheduleSheet({
  visible,
  onClose,
  group,
  repeats,
  repetitions,
  end,
  date,
  onChange,
}: {
  visible: boolean;
  onClose: () => void;
  /** FF3's own description of the schedule, when it holds one. */
  group: PlannedGroup | null | undefined;
  repeats: boolean;
  repetitions: Repetition[];
  end: EndCondition;
  /** The first date. */
  date: string;
  onChange: (patch: {
    date?: string;
    repeats?: boolean;
    repetitions?: Repetition[];
    end?: EndCondition;
  }) => void;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [more, setMore] = useState(false);

  const first = repetitions[0];
  // One weekly or monthly pattern every so often is what the simple choices can say.
  const simple =
    repetitions.length === 1 &&
    !!first &&
    first.skip === 0 &&
    (first.type === 'weekly' || first.type === 'monthly');
  const editing = repeats && (more || !simple);
  const how = !repeats
    ? 'once'
    : editing
      ? 'more'
      : first?.type === 'weekly'
        ? 'weekly'
        : 'monthly';
  const howOptions = [
    { key: 'once', label: tr('planned.howOnce') },
    { key: 'weekly', label: repetitionTypeName('weekly') },
    { key: 'monthly', label: repetitionTypeName('monthly') },
    { key: 'more', label: tr('planned.howMore') },
  ];

  function chooseHow(key: string) {
    if (key === 'more') {
      setMore(true);
      if (!repeats) onChange({ repeats: true });
      return;
    }
    setMore(false);
    if (key === 'once') {
      onChange({ repeats: false });
      return;
    }
    const type: RepetitionType = key === 'weekly' ? 'weekly' : 'monthly';
    onChange({
      repeats: true,
      repetitions: [{ type, moment: momentFor(type, date), skip: 0, weekend: first?.weekend ?? 1 }],
    });
  }

  /** The simple pattern's day follows the first date, unless the user has set the day by hand. */
  function moveDate(next: string) {
    const follows = simple && !more && !!first;
    onChange({
      date: next,
      ...(follows ? { repetitions: [{ ...first, moment: momentFor(first.type, next) }] } : {}),
    });
  }

  const today = localDay();
  const from = date > today ? date : today;
  const days = repeats
    ? upcomingOccurrences(repetitions, from, { count: 3 })
    : [date].filter((d) => d >= today);
  // "(moved to Fri)": a day a weekend rule pushed here, not one the pattern lands on by itself.
  const movedHere = (day: string) =>
    repeats &&
    repetitions.some((rep) =>
      expandRepetition(rep, from, 9).some(
        (raw) => raw !== day && withWeekendRule(raw, rep.weekend) === day,
      ),
    );
  const dayText = (day: string) =>
    movedHere(day)
      ? `${occurrenceLabel(day)} (${tr('planned.movedTo', { day: weekdayName(isoWeekday(day), 'short') })})`
      : occurrenceLabel(day);
  const summary = [scheduleLabel({ repeats, repetitions }, group), endLabel(end, repeats)]
    .filter(Boolean)
    .join(' · ');

  const close = () => {
    setChoice(null);
    onClose();
  };

  return (
    <Sheet
      visible={visible}
      title={choice?.title ?? tr('planned.schedule')}
      onClose={close}
      onBack={choice ? () => setChoice(null) : undefined}
      footer={choice ? undefined : <Button title={tr('common.done')} onPress={close} size="lg" />}
    >
      {choice ? (
        <Card flush>
          {choice.options.map((o, i) => (
            <ListRow
              key={o.key}
              first={i === 0}
              label={o.label}
              onPress={() => {
                choice.onSelect(o.key);
                setChoice(null);
              }}
              trailing={
                o.key === choice.selected ? (
                  <Ionicons name="checkmark" size={20} color={t.color.accent} />
                ) : undefined
              }
            />
          ))}
        </Card>
      ) : (
        <>
          <View
            style={{
              backgroundColor: t.color.accentSoft,
              borderRadius: t.radius.md,
              padding: t.space.md,
              gap: 4,
            }}
          >
            <Text style={[t.type.body, { color: t.color.text, fontWeight: '600' }]}>{summary}</Text>
            {days.length > 0 && (
              <Text style={[t.type.label, { color: t.color.accent }]}>
                {tr('planned.nextDates', { dates: days.map(dayText).join(' · ') })}
              </Text>
            )}
          </View>

          <SectionHeader title={tr('planned.starts')} />
          <Card>
            <ListRow
              first
              label={tr('planned.firstDate')}
              value={dayLabel(date)}
              chevron
              onPress={() => pickDate(new Date(`${date}T12:00:00`), (d) => moveDate(localDay(d)))}
            />
          </Card>

          <SectionHeader title={tr('planned.repeats')} />
          <Card>
            <ListRow
              first
              label={tr('planned.howOften')}
              value={howOptions.find((o) => o.key === how)?.label ?? ''}
              chevron
              onPress={() =>
                setChoice({
                  title: tr('planned.howOften'),
                  options: howOptions,
                  selected: how,
                  onSelect: chooseHow,
                })
              }
            />
            {repeats && !editing && !!first && (
              <ListRow
                label={tr('planned.weekendLabel')}
                value={weekendName(first.weekend)}
                chevron
                onPress={() =>
                  setChoice(
                    weekendChoice(tr('planned.weekendLabel'), first.weekend, (weekend) =>
                      onChange({ repetitions: [{ ...first, weekend }] }),
                    ),
                  )
                }
              />
            )}
          </Card>

          {repeats && !editing && (
            <EndRows
              end={end}
              date={date}
              onChange={(next) => onChange({ end: next })}
              choose={setChoice}
            />
          )}
          {editing && (
            <ScheduleRows
              repetitions={repetitions}
              end={end}
              date={date}
              onChange={onChange}
              choose={setChoice}
            />
          )}
        </>
      )}
    </Sheet>
  );
}

/** The ISO weekday (Mon = 1) of a `YYYY-MM-DD` day. */
const isoWeekday = (day: string): number => ((new Date(`${day}T12:00:00`).getDay() + 6) % 7) + 1;

/** The full repetition editor, shown under "More…". */
function ScheduleRows({
  repetitions,
  end,
  date,
  onChange,
  choose,
}: {
  repetitions: Repetition[];
  end: EndCondition;
  /** The planned date: what a new row and a switched type take their `moment` from. */
  date: string;
  onChange: (patch: { repetitions?: Repetition[]; end?: EndCondition }) => void;
  choose: Choose;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();

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
        <Card key={i} style={{ marginBottom: t.space.sm }}>
          <ListRow
            first
            label={tr('planned.repTypeLabel')}
            value={repetitionTypeName(rep.type)}
            chevron
            onPress={() =>
              choose({
                title: tr('planned.repTypeLabel'),
                options: REPETITION_TYPES.map((type) => ({
                  key: type,
                  label: repetitionTypeName(type),
                })),
                selected: rep.type,
                onSelect: (key) => {
                  const type = REPETITION_TYPES.find((x) => x === key);
                  if (type) changeType(i, type);
                },
              })
            }
          />
          {(rep.type === 'weekly' || rep.type === 'ndom') && (
            <ListRow
              label={tr('planned.weekdayLabel')}
              value={weekdayName(
                rep.type === 'ndom' ? parseNdom(rep.moment).weekday : Number(rep.moment) || 1,
              )}
              chevron
              onPress={() =>
                choose({
                  title: tr('planned.weekdayLabel'),
                  options: range(1, 7).map((d) => ({ key: d, label: weekdayName(Number(d)) })),
                  selected: String(
                    rep.type === 'ndom' ? parseNdom(rep.moment).weekday : Number(rep.moment) || 1,
                  ),
                  onSelect: (key) =>
                    patchRow(i, {
                      moment:
                        rep.type === 'ndom'
                          ? ndomMoment(parseNdom(rep.moment).nth, Number(key))
                          : key,
                    }),
                })
              }
            />
          )}
          {rep.type === 'monthly' && (
            <ListRow
              label={tr('planned.dayOfMonthLabel')}
              value={String(Number(rep.moment) || 1)}
              chevron
              onPress={() =>
                choose({
                  title: tr('planned.dayOfMonthLabel'),
                  options: range(1, 31).map((d) => ({ key: d, label: d })),
                  selected: String(Number(rep.moment) || 1),
                  onSelect: (key) => patchRow(i, { moment: key }),
                })
              }
            />
          )}
          {rep.type === 'ndom' && (
            <ListRow
              label={tr('planned.nthLabel')}
              value={nthName(parseNdom(rep.moment).nth)}
              chevron
              onPress={() =>
                choose({
                  title: tr('planned.nthLabel'),
                  options: range(1, 5).map((n) => ({ key: n, label: nthName(Number(n)) })),
                  selected: String(parseNdom(rep.moment).nth),
                  onSelect: (key) =>
                    patchRow(i, {
                      moment: ndomMoment(Number(key), parseNdom(rep.moment).weekday),
                    }),
                })
              }
            />
          )}
          {rep.type === 'yearly' && (
            <ListRow
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
          <ListRow
            label={tr('planned.weekendLabel')}
            value={weekendName(rep.weekend)}
            chevron
            onPress={() =>
              choose(
                weekendChoice(tr('planned.weekendLabel'), rep.weekend, (weekend) =>
                  patchRow(i, { weekend }),
                ),
              )
            }
          />
          {repetitions.length > 1 && (
            <ListRow
              label={tr('planned.repetitionRemove')}
              icon="close-circle"
              tone="danger"
              onPress={() => onChange({ repetitions: repetitions.filter((_, x) => x !== i) })}
            />
          )}
        </Card>
      ))}

      <EndRows end={end} date={date} onChange={(next) => onChange({ end: next })} choose={choose} />
    </>
  );
}

/** Where the schedule stops: until changed, on a date, or after a number of times. */
function EndRows({
  end,
  date,
  onChange,
  choose,
}: {
  end: EndCondition;
  date: string;
  onChange: (end: EndCondition) => void;
  choose: Choose;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  return (
    <Card style={{ marginBottom: t.space.sm }}>
      <ListRow
        first
        label={tr('planned.endLabel')}
        value={tr(`planned.end.${end.kind}`)}
        chevron
        onPress={() =>
          choose({
            title: tr('planned.endLabel'),
            options: (['forever', 'until', 'times'] as const).map((kind) => ({
              key: kind,
              label: tr(`planned.end.${kind}`),
            })),
            selected: end.kind,
            onSelect: (key) => {
              // Both start from something valid, so Save is never blocked by an unset value.
              if (key === 'forever') onChange({ kind: 'forever' });
              if (key === 'until') onChange({ kind: 'until', date: inAYear(date) });
              if (key === 'times') onChange({ kind: 'times', count: 12 });
            },
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
              onChange({ kind: 'until', date: localDay(d) }),
            )
          }
        />
      )}
      {end.kind === 'times' && (
        <Stepper
          label={tr('planned.endCountLabel')}
          value={Math.max(2, end.count)}
          min={2}
          onChange={(count) => onChange({ kind: 'times', count })}
        />
      )}
    </Card>
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
