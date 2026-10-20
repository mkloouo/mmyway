// New planned transaction (Planned tab → +): a three-step modal, What · When · Check. The fields,
// their validation and the save are the item page's new-payment path (app/planned/[key].tsx with key
// 'new'): the same blank form, the same plannedProblems(), the same savePlanned(). Nothing is queued
// until Create.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useDb } from '../../src/providers/DbProvider';
import { useTheme } from '../../src/ui/theme';
import { Button, ModalWizard, Sheet, Toast } from '../../src/ui/kit';
import { TagsField } from '../../src/ui/TagsField';
import { formatMoney } from '../../src/ui/money';
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
import { endLabel, occurrenceLabel, scheduleLabel } from '../../src/planned/labels';
import { movedOccurrenceLabel } from '../../src/ui/ScheduleSummary';
import { upcomingOccurrences } from '../../src/planned/occurrences';
import { savePlanned } from '../../src/planned/actions';
import {
  ReminderPromptSheet,
  shouldShowReminderPrompt,
} from '../../src/planned/ReminderPromptSheet';
import { localDay } from '../../src/utils/day';
import { usePlannedForm } from '../../src/planned/usePlannedForm';
import { PlannedFormSheets } from '../../src/planned/PlannedFormSheets';
import { REMIND_CHOICES, remindLabel } from '../../src/planned/remind';
import {
  NewPlannedStep1,
  NewPlannedStep2,
  NewPlannedStep3,
} from '../../src/planned/NewPlannedSteps';

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
  const [tagsSheetOpen, setTagsSheetOpen] = useState(false);
  const [globalRemind, setGlobalRemind] = useState<{ when: ReminderWhen; time: string } | null>(
    null,
  );
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
  const how = !fields.repeats
    ? 'once'
    : first && simple
      ? (first.type as 'weekly' | 'monthly')
      : 'more';

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
          later: later.map((d) => movedOccurrenceLabel(d, fields.repetitions, from)).join(', '),
        })
      : tr('planned.new.firstOnly', { date: occurrenceLabel(fields.date) });

  const close = useConfirmDiscard(edited, 'planned.new.discardTitle');

  const create = act(
    tr('planned.new.create'),
    async () => {
      if (problems.length > 0) return;
      await savePlanned(db, null, next);
      if (remindChoice) await setReminderOverride(db, normkey(next.name), remindChoice);
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
        concise: true,
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
          <Sheet
            visible={tagsSheetOpen}
            onClose={() => setTagsSheetOpen(false)}
            title={tr('fields.tags')}
            footer={
              <Button
                title={tr('common.done')}
                variant="primary"
                onPress={() => setTagsSheetOpen(false)}
              />
            }
          >
            <View style={{ padding: t.space.lg }}>
              <TagsField
                tags={fields.tags}
                onChange={(tags) => set({ tags })}
                suggestions={recentTags}
              />
            </View>
          </Sheet>
        </>
      }
    >
      {step === 1 && (
        <NewPlannedStep1
          fields={fields}
          changeType={changeType}
          set={set}
          setSheet={setSheet}
          currency={currency}
          fromText={fromText}
          toText={toText}
          ownFrom={ownFrom}
          ownTo={ownTo}
        />
      )}

      {step === 2 && (
        <NewPlannedStep2
          fields={fields}
          how={how}
          chooseHow={chooseHow}
          setScheduleOpen={setScheduleOpen}
          moveDate={moveDate}
          set={set}
          from={from}
          nextDays={nextDays}
          scheduleText={scheduleText}
        />
      )}

      {step === 3 && (
        <NewPlannedStep3
          fields={fields}
          next={next}
          amountText={amountText}
          fromText={fromText}
          toText={toText}
          scheduleText={scheduleText}
          firstLine={firstLine}
          remindText={remindText}
          set={set}
          setSheet={setSheet}
          setTagsSheetOpen={setTagsSheetOpen}
        />
      )}
    </ModalWizard>
  );
}
