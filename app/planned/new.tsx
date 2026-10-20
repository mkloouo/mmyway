// New planned transaction (Planned tab → +): a three-step modal, What · When · Check. The fields,
// their validation and the save are the item page's new-payment path (app/planned/[key].tsx with key
// 'new'): the same blank form, the same plannedProblems(), the same savePlanned(). Nothing is queued
// until Create.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
// eslint-disable-next-line no-restricted-imports -- kit-exception: pre-Kit-V2 (MKL-87)
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useDb } from '../../src/providers/DbProvider';
import { useTheme } from '../../src/ui/theme';
import {
  Card,
  ROW_HEIGHT,
  ListRow,
  ModalWizard,
  SectionHeader,
  Segmented,
  Toast,
} from '../../src/ui/kit';
import { TextField } from '../../src/ui/TextField';
import { TagsField } from '../../src/ui/TagsField';
import { pickDate } from '../../src/ui/pickDate';
import { formatMoney, signFor } from '../../src/ui/money';
import { useAction } from '../../src/ui/useAction';
import { useToast } from '../../src/ui/useToast';
import { useConfirmDiscard } from '../../src/ui/useConfirmDiscard';
import { useRecentTags } from '../../src/lookup/recentTags';
import {
  getReminderTime,
  getReminderWhen,
  setReminderOverride,
  type ReminderWhen,
} from '../../src/settings/appSettings';
import { normkey } from '../../src/lookup/normkey';
import { momentFor, type RepetitionType } from '../../src/planned/repetition';
import { dayLabel, endLabel, occurrenceLabel, scheduleLabel } from '../../src/planned/labels';
import { upcomingOccurrences } from '../../src/planned/occurrences';
import { savePlanned } from '../../src/planned/actions';
import {
  ReminderPromptSheet,
  shouldShowReminderPrompt,
} from '../../src/planned/ReminderPromptSheet';
import { localDay } from '../../src/utils/day';
import { TX_TYPES } from '../../src/transactions/txTypes';
import { usePlannedForm } from '../../src/planned/usePlannedForm';
import { PlannedFormSheets } from '../../src/planned/PlannedFormSheets';
import { TimeRows } from '../../src/ui/TimeRows';
import { REMIND_CHOICES, remindLabel } from '../../src/planned/remind';

type Step = 1 | 2 | 3;

/** The problems Step 1 owns; a schedule problem is Step 2's to show. */
const STEP1_PROBLEMS = new Set(['name', 'amount', 'currency', 'source', 'destination']);

export default function NewPlannedScreen() {
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const act = useAction();
  const [toast, setToast] = useToast();
  const recentTags = useRecentTags();

  const form = usePlannedForm(null);
  const {
    fields,
    set,
    setSheet,
    setScheduleOpen,
    changeType,
    currency,
    currencyRows,
    problems,
    ownFrom,
    ownTo,
    fromText,
    toText,
    next,
    edited,
  } = form;

  const [step, setStep] = useState<Step>(1);
  const [prompt, setPrompt] = useState<{ name: string; account?: string } | null>(null);
  // The global reminder timing and time, what 'Default' means on this row.
  const [globalRemind, setGlobalRemind] = useState<{ when: ReminderWhen; time: string } | null>(
    null,
  );
  // null is Default: no override is stored for the payment.
  const [remindChoice, setRemindChoice] = useState<ReminderWhen | 'off' | null>(null);

  useEffect(() => {
    void (async () => {
      const [when, time] = await Promise.all([getReminderWhen(db), getReminderTime(db)]);
      setGlobalRemind({ when, time });
    })();
  }, [db]);

  const step1Ok = !problems.some((p) => STEP1_PROBLEMS.has(p));
  const amountText = currencyRows ? formatMoney(fields.amount, currency) : '';

  // The schedule: "How often" picks the simple patterns directly, as the schedule sheet does.
  const today = localDay();
  const first = fields.repetitions[0];
  const simple =
    fields.repetitions.length === 1 &&
    !!first &&
    first.skip === 0 &&
    (first.type === 'weekly' || first.type === 'monthly');
  const how = !fields.repeats ? 'once' : first && simple ? first.type : 'more';

  function chooseHow(key: 'once' | 'weekly' | 'monthly') {
    if (key === 'once') {
      set({ repeats: false });
      return;
    }
    const type: RepetitionType = key;
    set({
      repeats: true,
      repetitions: [
        { type, moment: momentFor(type, fields.date), skip: 0, weekend: first?.weekend ?? 1 },
      ],
    });
  }

  /** The simple pattern's day follows the first date, unless it has been set by hand. */
  function moveDate(nextDate: string) {
    set({
      date: nextDate,
      ...(simple && first
        ? { repetitions: [{ ...first, moment: momentFor(first.type, nextDate) }] }
        : {}),
    });
  }

  const from = fields.date > today ? fields.date : today;
  const nextDays = fields.repeats
    ? upcomingOccurrences(fields.repetitions, from, { count: 4 })
    : [fields.date].filter((d) => d >= today);
  const scheduleText = [scheduleLabel(fields), endLabel(fields.end, fields.repeats)]
    .filter(Boolean)
    .join(' · ');
  const later = nextDays.filter((d) => d !== fields.date).slice(0, 3);
  const firstLine =
    fields.repeats && later.length > 0
      ? tr('planned.new.firstThen', {
          first: occurrenceLabel(fields.date),
          later: later.map((d) => occurrenceLabel(d)).join(' · '),
        })
      : tr('planned.new.firstOnly', { date: occurrenceLabel(fields.date) });

  const close = useConfirmDiscard(edited, 'planned.new.discardTitle');

  const create = act(
    tr('planned.new.create'),
    async () => {
      if (problems.length > 0) return;
      await savePlanned(db, null, next);
      // The queued payment is keyed by its name once it syncs, so the override goes under that key.
      if (remindChoice) await setReminderOverride(db, normkey(next.name), remindChoice);
      // Once, after the first payment, while reminders are off; then back to the Planned tab.
      if (await shouldShowReminderPrompt(db)) {
        setPrompt({
          name: next.name,
          account: fields.type === 'deposit' ? undefined : fromText,
        });
        return;
      }
      router.back();
    },
    setToast,
  );
  const saving = act.pending(tr('planned.new.create'));

  const remindText = !globalRemind
    ? '—'
    : remindLabel({
        override: remindChoice,
        when: globalRemind.when,
        time: fields.time ?? globalRemind.time,
      });

  const problemText =
    problems.length > 0
      ? tr('readiness.missing', {
          fields: problems.map((p) => tr(`planned.problem.${p}`)).join(', '),
        })
      : null;

  return (
    <ModalWizard
      title={tr('planned.new.title')}
      step={step}
      total={3}
      onClose={close}
      problem={step === 3 ? problemText : undefined}
      onBack={step > 1 ? () => setStep((s) => (s - 1) as Step) : undefined}
      primary={
        step === 1
          ? {
              label: tr('account.continue'),
              disabled: !step1Ok,
              onPress: () => setStep(2),
            }
          : step === 2
            ? {
                label: tr('account.continue'),
                disabled: problems.length > 0,
                onPress: () => setStep(3),
              }
            : {
                label: tr('planned.new.create'),
                disabled: problems.length > 0 || saving,
                onPress: () => {
                  void create();
                },
              }
      }
      afterFooter={
        <>
          <Toast message={toast} />
          <PlannedFormSheets
            form={form}
            group={null}
            remind={globalRemind ? { override: remindChoice, when: globalRemind.when } : null}
            onChooseRemind={(key) => setRemindChoice(REMIND_CHOICES.find((x) => x === key) ?? null)}
          />
          <ReminderPromptSheet
            visible={!!prompt}
            plannedName={prompt?.name ?? ''}
            accountName={prompt?.account}
            onDone={() => router.back()}
          />
        </>
      }
    >
      {step === 1 && (
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
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: t.space.md,
                minHeight: ROW_HEIGHT,
              }}
            >
              <Text style={[t.type.body, { color: t.color.text }]}>{tr('planned.new.name')}</Text>
              <TextField
                value={fields.name}
                onChangeText={(name) => set({ name })}
                placeholder={tr('planned.namePlaceholder')}
                style={{ flex: 1, borderWidth: 0, paddingHorizontal: 0, textAlign: 'right' }}
              />
            </View>
            <ListRow
              label={tr('fields.amount')}
              value={amountText}
              chevron
              onPress={() => setSheet('amount')}
            />
            <ListRow
              label={tr('fields.currency')}
              value={fields.currencyCode || '—'}
              chevron
              onPress={() => setSheet('currency')}
            />
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
      )}

      {step === 2 && (
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
          <View
            accessibilityRole="radiogroup"
            // eslint-disable-next-line no-restricted-syntax -- kit-exception: pre-Kit-V2 literal (MKL-81)
            style={{ flexDirection: 'row', gap: 6, marginHorizontal: t.space.lg }}
          >
            {(
              [
                { key: 'once', label: tr('planned.new.once') },
                { key: 'weekly', label: tr('planned.repType.weekly') },
                { key: 'monthly', label: tr('planned.repType.monthly') },
                { key: 'more', label: tr('planned.new.more') },
              ] as const
            ).map((o) => {
              const on = o.key === how;
              return (
                <Pressable
                  key={o.key}
                  onPress={() => (o.key === 'more' ? setScheduleOpen(true) : chooseHow(o.key))}
                  accessibilityRole="radio"
                  accessibilityLabel={o.label}
                  accessibilityState={{ checked: on }}
                  style={{
                    flex: 1,
                    height: 44,
                    borderRadius: t.radius.md,
                    borderWidth: on ? 2 : 1,
                    borderColor: on ? t.color.accent : t.color.border,
                    backgroundColor: on ? t.color.accentSoft : t.color.surface,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text
                    numberOfLines={1}
                    style={[t.type.body, { color: t.color.text, fontWeight: '600' }]}
                  >
                    {o.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

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
                  label={scheduleText}
                  value={tr('planned.new.change')}
                  chevron
                  onPress={() => setScheduleOpen(true)}
                />
              </Card>
            </>
          )}

          <View
            style={{
              marginTop: t.space.lg,
              marginHorizontal: t.space.lg,
              backgroundColor: t.color.accentSoft,
              borderRadius: t.radius.md,
              padding: t.space.md,
              // eslint-disable-next-line no-restricted-syntax -- kit-exception: pre-Kit-V2 literal (MKL-81)
              gap: 4,
            }}
          >
            <Text style={[t.type.body, { color: t.color.text, fontWeight: '600' }]}>
              {scheduleText || tr('planned.once')}
            </Text>
            {nextDays.length > 0 && (
              <Text style={[t.type.label, { color: t.color.accent }]}>
                {nextDays.map((d) => occurrenceLabel(d)).join(' · ')}
              </Text>
            )}
          </View>
        </>
      )}

      {step === 3 && (
        <>
          <View
            style={{
              marginTop: t.space.md,
              marginHorizontal: t.space.lg,
              backgroundColor: t.color.accentSoft,
              borderRadius: t.radius.md,
              padding: t.space.md,
              // eslint-disable-next-line no-restricted-syntax -- kit-exception: pre-Kit-V2 literal (MKL-81)
              gap: 4,
            }}
          >
            <Text style={[t.type.body, { color: t.color.text, fontWeight: '600' }]}>
              {tr('planned.new.summaryTitle', {
                name: next.name,
                amount: `${signFor(fields.type)}${amountText}`,
              })}
            </Text>
            <Text style={[t.type.body, { color: t.color.text }]}>
              {tr('planned.new.summaryRoute', {
                schedule: scheduleText || tr('planned.once'),
                from: fromText,
                to: toText,
              })}
            </Text>
            <Text style={[t.type.label, { color: t.color.accent }]}>{firstLine}</Text>
          </View>

          <SectionHeader title={tr('planned.new.sectionExtras')} />
          <Card style={{ marginHorizontal: t.space.lg, gap: t.space.sm }}>
            <ListRow
              first
              label={tr('planned.remind.title')}
              value={remindText}
              chevron
              onPress={() => setSheet('remind')}
            />
            <Text style={[t.type.label, { color: t.color.textMuted }]}>
              {tr('planned.new.note')}
            </Text>
            <TextField
              value={fields.notes ?? ''}
              onChangeText={(notes) => set({ notes: notes || null })}
              placeholder={tr('planned.new.notePlaceholder')}
              multiline
              style={{ minHeight: 60 }}
            />
            <Text style={[t.type.label, { color: t.color.textMuted }]}>{tr('fields.tags')}</Text>
            <TagsField
              tags={fields.tags}
              onChange={(tags) => set({ tags })}
              suggestions={recentTags}
            />
          </Card>

          <SectionHeader title={tr('planned.new.sectionSaved')} />
          <Card style={{ marginHorizontal: t.space.lg }}>
            <View
              style={{
                gap: 2 /* eslint-disable-line no-restricted-syntax -- kit-exception: pre-Kit-V2 literal (MKL-81) */,
                padding: t.space.md,
              }}
            >
              <Text style={[t.type.body, { color: t.color.text }]}>
                {tr('planned.new.savedAs')}
              </Text>
              <Text style={[t.type.label, { color: t.color.textMuted }]}>
                {tr('planned.new.savedAsHint', { name: next.name })}
              </Text>
            </View>
          </Card>
        </>
      )}
    </ModalWizard>
  );
}
