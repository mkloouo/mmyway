// New planned transaction (Planned tab → +): a three-step modal, What · When · Check. The fields,
// their validation and the save are the item page's new-payment path (app/planned/[key].tsx with key
// 'new'): the same blank form, the same plannedProblems(), the same savePlanned(). Nothing is queued
// until Create.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useDb } from '../../src/providers/DbProvider';
import { useCategories, useCurrencyRows } from '../../src/db/useReferenceData';
import { useTheme } from '../../src/ui/theme';
// prettier-ignore
import { Button, Card, ModalHeader, ROW_HEIGHT, ListRow, Screen, SectionHeader, Segmented, StickyFooter, Toast } from '../../src/ui/kit';
import { TextField } from '../../src/ui/TextField';
import { TagsField } from '../../src/ui/TagsField';
import { PickerSheet } from '../../src/ui/PickerSheet';
import { AccountPickerSheet } from '../../src/ui/AccountPickerSheet';
import { PayeeSheet } from '../../src/ui/PayeeSheet';
import { AmountSheet } from '../../src/ui/AmountSheet';
import { pickDate, pickTime } from '../../src/ui/pickDate';
import { currencyOf, formatMoney, signFor } from '../../src/ui/money';
import { pickableCurrencies, primaryCurrencyCode } from '../../src/ui/currencies';
import { useAction } from '../../src/ui/useAction';
import { useToast } from '../../src/ui/useToast';
import { useConfirmDiscard } from '../../src/ui/useConfirmDiscard';
import { referenceCurrencies } from '../../src/db/schema';
import { useAssetAccounts } from '../../src/accounts/useAssetAccounts';
import type { MerchantHistory } from '../../src/lookup/merchantLookup';
import { useMerchantHistories } from '../../src/lookup/useMerchantHistories';
import { useRecentTags } from '../../src/lookup/recentTags';
import {
  getDefaultCurrencyCode,
  getDefaultSourceAccountId,
  getReminderTime,
  getReminderWhen,
  setReminderOverride,
  type ReminderWhen,
} from '../../src/settings/appSettings';
import { normkey } from '../../src/lookup/normkey';
import { plannedProblems, type PlannedFields } from '../../src/planned/model';
import { defaultRepetition, momentFor, type RepetitionType } from '../../src/planned/repetition';
import { dayLabel, endLabel, occurrenceLabel, scheduleLabel } from '../../src/planned/labels';
import { upcomingOccurrences } from '../../src/planned/occurrences';
import { savePlanned } from '../../src/planned/actions';
import {
  ReminderPromptSheet,
  shouldShowReminderPrompt,
} from '../../src/planned/ReminderPromptSheet';
import { ScheduleSheet } from '../../src/ui/ScheduleRows';
import { localDay } from '../../src/utils/day';
import { TX_TYPES } from '../../src/transactions/txTypes';

type Step = 1 | 2 | 3;
type OpenSheet = 'amount' | 'currency' | 'own' | 'ownTo' | 'payee' | 'category' | 'remind' | null;

const REMIND_CHOICES: readonly (ReminderWhen | 'off')[] = [
  'day',
  'dayBefore',
  'fewDays',
  'week',
  'off',
];

/** The problems Step 1 owns; a schedule problem is Step 2's to show. */
const STEP1_PROBLEMS = new Set(['name', 'amount', 'currency', 'source', 'destination']);

/** Same blank form as the item page's new-payment path (app/planned/[key].tsx). */
function blank(): PlannedFields {
  return {
    name: '',
    type: 'withdrawal',
    sourceId: null,
    sourceName: null,
    destinationId: null,
    destinationName: null,
    amount: '0',
    currencyCode: '',
    notes: null,
    repeats: true,
    repetitions: [defaultRepetition(localDay())],
    end: { kind: 'forever' },
    date: localDay(),
    time: null,
    skipDays: [],
    categoryName: null,
    tags: [],
  };
}

export default function NewPlannedScreen() {
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const act = useAction();
  const [toast, setToast] = useToast();
  const assetAccounts = useAssetAccounts({ includeLiabilities: true }) ?? [];
  const categories = useCategories();
  // undefined until the reference currencies load: see the item page for why.
  const currencyRows = useCurrencyRows();
  const currencies = currencyRows ?? [];
  const recentTags = useRecentTags();

  const [step, setStep] = useState<Step>(1);
  const [fields, setFields] = useState<PlannedFields>(blank);
  // Set by the user's own changes: the defaults filled in on load don't count.
  const [edited, setEdited] = useState(false);
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [prompt, setPrompt] = useState<{ name: string; account?: string } | null>(null);
  // The global reminder timing and time, what 'Default' means on this row.
  const [globalRemind, setGlobalRemind] = useState<{ when: ReminderWhen; time: string } | null>(
    null,
  );
  // null is Default: no override is stored for the payment.
  const [remindChoice, setRemindChoice] = useState<ReminderWhen | 'off' | null>(null);
  const [chosen, setChosen] = useState<{ category: boolean; account: boolean }>({
    category: false,
    account: false,
  });

  useEffect(() => {
    void (async () => {
      const [when, time] = await Promise.all([getReminderWhen(db), getReminderTime(db)]);
      setGlobalRemind({ when, time });
    })();
  }, [db]);

  // A new one starts from capture's defaults: the default account and currency.
  useEffect(() => {
    void (async () => {
      const [accountId, currency, currencyRowsNow] = await Promise.all([
        getDefaultSourceAccountId(db),
        getDefaultCurrencyCode(db),
        db.select().from(referenceCurrencies),
      ]);
      setFields((f) => ({
        ...f,
        sourceId: f.sourceId ?? accountId,
        currencyCode: f.currencyCode || currency || primaryCurrencyCode(currencyRowsNow) || '',
      }));
    })();
  }, [db]);

  const payeeType = fields.type === 'deposit' ? 'deposit' : 'withdrawal';
  const histories = useMerchantHistories(payeeType);

  const set = (patch: Partial<PlannedFields>) => {
    setEdited(true);
    setFields((f) => ({ ...f, ...patch }));
  };
  const currency = currencyOf(currencies, fields.currencyCode);
  const problems = plannedProblems(fields);
  const step1Ok = !problems.some((p) => STEP1_PROBLEMS.has(p));
  const accountName = (id: string | null, name: string | null) =>
    (id ? (assetAccounts.find((a) => a.id === id)?.name ?? name) : name) ?? '—';

  // Which end is the user's own account and which the payee/payer.
  const ownFrom = fields.type !== 'deposit';
  const ownTo = fields.type !== 'withdrawal';
  const fromText =
    (ownFrom ? accountName(fields.sourceId, fields.sourceName) : fields.sourceName) ?? '—';
  const toText =
    (ownTo ? accountName(fields.destinationId, fields.destinationName) : fields.destinationName) ??
    '—';
  const amountText = currencyRows ? formatMoney(fields.amount, currency) : '';

  /** A payee picked from history also fills what's usually booked with it, where not chosen. */
  function choosePayee(h: MerchantHistory) {
    const patch: Partial<PlannedFields> =
      fields.type === 'deposit'
        ? { sourceName: h.displayName, sourceId: null }
        : { destinationName: h.displayName, destinationId: null };
    if (!chosen.category && !fields.categoryName && h.topCategory) {
      patch.categoryName = h.topCategory;
    }
    const account =
      !chosen.account && h.topAccountName
        ? assetAccounts.find((a) => a.name === h.topAccountName)
        : undefined;
    if (account) {
      const leg = fields.type === 'deposit' ? 'destination' : 'source';
      patch[`${leg}Id`] = account.id;
      patch[`${leg}Name`] = account.name;
    }
    set(patch);
  }

  /** The own account moves to the end the new type keeps it on; the payee/payer starts empty. */
  function changeType(type: PlannedFields['type']) {
    if (type === fields.type) return;
    const own = ownFrom
      ? { id: fields.sourceId, name: fields.sourceName }
      : { id: fields.destinationId, name: fields.destinationName };
    const none = { id: null, name: null };
    const source = type === 'deposit' ? none : own;
    const destination = type === 'withdrawal' ? none : type === 'deposit' ? own : none;
    set({
      type,
      sourceId: source.id,
      sourceName: source.name,
      destinationId: destination.id,
      destinationName: destination.name,
    });
  }

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
  function moveDate(next: string) {
    set({
      date: next,
      ...(simple && first
        ? { repetitions: [{ ...first, moment: momentFor(first.type, next) }] }
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

  const next: PlannedFields = {
    ...fields,
    name: fields.name.trim(),
    tags: fields.tags,
  };
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
    : remindChoice === 'off'
      ? tr('planned.remind.off')
      : [
          remindChoice
            ? tr(`planned.remind.${remindChoice}`)
            : tr('planned.remind.default', { when: tr(`planned.remind.${globalRemind.when}`) }),
          // A payment's own time wins over the global one, as the reminder itself does.
          fields.time ?? globalRemind.time,
        ].join(' · ');

  const problemText =
    problems.length > 0
      ? tr('readiness.missing', {
          fields: problems.map((p) => tr(`planned.problem.${p}`)).join(', '),
        })
      : null;

  return (
    <Screen modal bottom avoidKeyboard>
      <ModalHeader
        title={tr('planned.new.title')}
        onClose={close}
        step={step}
        steps={3}
        stepLabel={tr('account.stepOf', { step, total: 3 })}
      />

      <ScrollView
        contentContainerStyle={{ paddingBottom: t.space.xl, paddingTop: t.space.sm }}
        keyboardShouldPersistTaps="handled"
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
              <ListRow
                label={tr('planned.time')}
                value={fields.time ?? tr('planned.anyTime')}
                chevron
                onPress={() => pickTime(fields.time, (time) => set({ time }))}
              />
              {!!fields.time && (
                <ListRow
                  label={tr('planned.clearTime')}
                  icon="close-circle"
                  onPress={() => set({ time: null })}
                />
              )}
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
      </ScrollView>

      {step === 3 && !!problemText && (
        <Text
          style={[
            t.type.label,
            { color: t.color.danger, marginHorizontal: t.space.lg, marginTop: t.space.sm },
          ]}
        >
          {problemText}
        </Text>
      )}
      {step === 1 && (
        <StickyFooter>
          <View style={{ flex: 1 }}>
            <Button
              title={tr('account.continue')}
              size="lg"
              disabled={!step1Ok}
              onPress={() => setStep(2)}
            />
          </View>
        </StickyFooter>
      )}
      {step === 2 && (
        <StickyFooter>
          <View style={{ flex: 1 }}>
            <Button
              title={tr('account.back')}
              size="lg"
              variant="secondary"
              onPress={() => setStep(1)}
            />
          </View>
          <View style={{ flex: 2 }}>
            <Button
              title={tr('account.continue')}
              size="lg"
              disabled={problems.length > 0}
              onPress={() => setStep(3)}
            />
          </View>
        </StickyFooter>
      )}
      {step === 3 && (
        <StickyFooter>
          <View style={{ flex: 1 }}>
            <Button
              title={tr('account.back')}
              size="lg"
              variant="secondary"
              onPress={() => setStep(2)}
            />
          </View>
          <View style={{ flex: 2 }}>
            <Button
              title={tr('planned.new.create')}
              size="lg"
              disabled={problems.length > 0 || saving}
              onPress={create}
            />
          </View>
        </StickyFooter>
      )}
      <Toast message={toast} />

      <ScheduleSheet
        visible={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        group={null}
        repeats={fields.repeats}
        repetitions={fields.repetitions}
        end={fields.end}
        date={fields.date}
        onChange={set}
      />
      <AmountSheet
        visible={sheet === 'amount'}
        title={tr('fields.amount')}
        initial={fields.amount}
        currency={currency}
        type={fields.type}
        onDone={(typed) => {
          if (typed !== null) set({ amount: typed });
          setSheet(null);
        }}
      />
      <PickerSheet
        visible={sheet === 'currency'}
        onClose={() => setSheet(null)}
        title={tr('fields.currency')}
        options={pickableCurrencies(currencies, fields.currencyCode).map((c) => ({
          key: c.code,
          label: c.code,
        }))}
        selected={fields.currencyCode}
        onSelect={(code) => code && set({ currencyCode: code })}
      />
      <AccountPickerSheet
        visible={sheet === 'own' || sheet === 'ownTo'}
        onClose={() => setSheet(null)}
        title={sheet === 'ownTo' ? tr('fields.to') : tr('fields.from')}
        accounts={assetAccounts}
        currencies={currencies}
        onSelect={(a) => {
          setChosen((c) => ({ ...c, account: true }));
          set(
            sheet === 'ownTo'
              ? { destinationId: a.id, destinationName: a.name }
              : { sourceId: a.id, sourceName: a.name },
          );
        }}
      />
      <PayeeSheet
        visible={sheet === 'payee'}
        onClose={() => setSheet(null)}
        histories={histories}
        payeeLabel={fields.type === 'deposit' ? 'payer' : 'payee'}
        onSelect={choosePayee}
        onCreateNew={(text) =>
          set(
            fields.type === 'deposit'
              ? { sourceName: text, sourceId: null }
              : { destinationName: text, destinationId: null },
          )
        }
      />
      <PickerSheet
        visible={sheet === 'category'}
        onClose={() => setSheet(null)}
        title={tr('fields.category')}
        options={categories.map((c) => ({ key: c.name, label: c.name }))}
        selected={fields.categoryName}
        onSelect={(categoryName) => {
          setChosen((c) => ({ ...c, category: true }));
          set({ categoryName });
        }}
        noneLabel={tr('common.none')}
      />
      {!!globalRemind && (
        <PickerSheet
          visible={sheet === 'remind'}
          onClose={() => setSheet(null)}
          title={tr('planned.remind.title')}
          options={[
            {
              key: 'default',
              label: tr('planned.remind.default', {
                when: tr(`planned.remind.${globalRemind.when}`),
              }),
            },
            ...REMIND_CHOICES.map((k) => ({ key: k, label: tr(`planned.remind.${k}`) })),
          ]}
          selected={remindChoice ?? 'default'}
          onSelect={(key) => {
            if (!key) return;
            setEdited(true);
            // 'default' is no choice in REMIND_CHOICES, so it leaves the override unset.
            setRemindChoice(REMIND_CHOICES.find((x) => x === key) ?? null);
          }}
        />
      )}
      <ReminderPromptSheet
        visible={!!prompt}
        plannedName={prompt?.name ?? ''}
        accountName={prompt?.account}
        onDone={() => router.back()}
      />
    </Screen>
  );
}
