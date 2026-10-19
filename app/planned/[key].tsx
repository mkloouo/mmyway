// One planned transaction in the simple view: its subscription, rule and recurring transaction
// edited together (src/planned/model.ts). Save queues it like any other change.
//
// A PUSH page: ‹ Planned in the header, the ••• for Book now and Delete, and the save bar only once
// something differs from what FF3 holds. The schedule is a sheet of its own (ScheduleSheet).
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useDb } from '../../src/providers/DbProvider';
import { useCategories, useCurrencyRows } from '../../src/db/useReferenceData';
import { useTheme } from '../../src/ui/theme';
// prettier-ignore
import { Card, MoreButton, PushHeader, ListRow, SCREEN_TOP_PADDING, Screen, SectionHeader, Segmented } from '../../src/ui/kit';
import { TextField } from '../../src/ui/TextField';
import { TagsField } from '../../src/ui/TagsField';
import { PickerSheet } from '../../src/ui/PickerSheet';
import { AccountPickerSheet } from '../../src/ui/AccountPickerSheet';
import { PayeeSheet } from '../../src/ui/PayeeSheet';
import { AmountSheet } from '../../src/ui/AmountSheet';
import { pickTime } from '../../src/ui/pickDate';
import { currencyOf, formatMoney } from '../../src/ui/money';
import { pickableCurrencies, primaryCurrencyCode } from '../../src/ui/currencies';
import { useAction } from '../../src/ui/useAction';
import { useConfirmDiscard } from '../../src/ui/useConfirmDiscard';
// eslint-disable-next-line no-restricted-imports -- kit-exception: pre-Kit-V2 (MKL-87)
import { referenceCurrencies } from '../../src/db/schema';
import { useAssetAccounts } from '../../src/accounts/useAssetAccounts';
import type { MerchantHistory } from '../../src/lookup/merchantLookup';
import { useMerchantHistories } from '../../src/lookup/useMerchantHistories';
import { useRecentTags } from '../../src/lookup/recentTags';
import {
  getDefaultCurrencyCode,
  getDefaultSourceAccountId,
  getReminderOverrides,
  getReminderWhen,
  setReminderOverride,
  type ReminderWhen,
} from '../../src/settings/appSettings';
import { usePlanned } from '../../src/planned/usePlanned';
import { plannedProblems, samePlannedFields, type PlannedFields } from '../../src/planned/model';
import { defaultRepetition } from '../../src/planned/repetition';
import { toggleSkipDay } from '../../src/planned/notes';
import { dayLabel, endLabel, scheduleLabel } from '../../src/planned/labels';
import { ScheduleSheet } from '../../src/ui/ScheduleRows';
import { OccurrenceRows } from '../../src/ui/OccurrenceRows';
import { deletePlanned, savePlanned, triggerPlanned } from '../../src/planned/actions';
import { syncPlannedNotifications } from '../../src/planned/notifications';
import type { PlannedItem } from '../../src/planned/items';
import { localDay } from '../../src/utils/day';
import { TX_TYPES } from '../../src/transactions/txTypes';
import { SaveBar } from '../../src/ui/SaveBar';

type TxType = PlannedFields['type'];

/** The reminder timings a payment can be given. 'default' is the global setting, i.e. no override. */
const REMIND_CHOICES: readonly (ReminderWhen | 'off')[] = [
  'day',
  'dayBefore',
  'fewDays',
  'week',
  'off',
];

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

export default function PlannedEditScreen() {
  const { key: rawKey, skip } = useLocalSearchParams<{ key: string; skip?: string }>();
  const key = decodeURIComponent(rawKey ?? 'new');
  const isNew = key === 'new';
  const t = useTheme();
  const { t: tr } = useTranslation();
  const { items, loaded } = usePlanned();
  const item = isNew ? null : (items.find((i) => i.key === key) ?? null);

  if (!isNew && !item) {
    return (
      <Screen bottom>
        <PushHeader backLabel={tr('planned.title')} onBack={() => router.back()} />
        {loaded && (
          <Text style={[t.type.body, { color: t.color.textMuted, padding: t.space.lg }]}>
            {tr('planned.gone')}
          </Text>
        )}
      </Screen>
    );
  }
  // Mounted once the item is known, so the form starts from its fields.
  return <PlannedEditor item={item} skipDay={typeof skip === 'string' ? skip : null} />;
}

function PlannedEditor({ item, skipDay }: { item: PlannedItem | null; skipDay: string | null }) {
  const isNew = !item;
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const act = useAction();
  const assetAccounts = useAssetAccounts({ includeLiabilities: true }) ?? [];
  const categories = useCategories();
  // undefined until the reference currencies load: the amount would otherwise be drawn with the
  // currency code standing in for its symbol, then redrawn a frame later at a different width.
  const currencyRows = useCurrencyRows();
  const currencies = currencyRows ?? [];

  const [fields, setFields] = useState<PlannedFields>(() => item?.fields ?? blank());
  const recentTags = useRecentTags();
  const [sheet, setSheet] = useState<
    'amount' | 'currency' | 'own' | 'ownTo' | 'payee' | 'category' | 'remind' | null
  >(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  // Local to this device, not part of the form: it is saved the moment it is picked.
  const [remind, setRemind] = useState<{
    override: ReminderWhen | 'off' | null;
    when: ReminderWhen;
  } | null>(null);
  // What the user chose themselves: a payee's history never overwrites those. The default
  // account a new one starts with isn't a choice, so history may replace it.
  const [chosen, setChosen] = useState<{ category: boolean; account: boolean }>(() => ({
    category: !!item?.fields.categoryName,
    account: !!item,
  }));

  // A new one starts from capture's defaults: the default account and currency.
  useEffect(() => {
    if (!isNew) return;
    void (async () => {
      const [accountId, currency, currencyRows] = await Promise.all([
        getDefaultSourceAccountId(db),
        getDefaultCurrencyCode(db),
        db.select().from(referenceCurrencies),
      ]);
      setFields((f) => ({
        ...f,
        sourceId: f.sourceId ?? accountId,
        currencyCode: f.currencyCode || currency || primaryCurrencyCode(currencyRows) || '',
      }));
    })();
  }, [isNew, db]);

  const itemKey = item?.key ?? null;
  useEffect(() => {
    if (!itemKey) return;
    let live = true;
    void (async () => {
      const [overrides, when] = await Promise.all([getReminderOverrides(db), getReminderWhen(db)]);
      if (live) setRemind({ override: overrides[itemKey] ?? null, when });
    })();
    return () => {
      live = false;
    };
  }, [db, itemKey]);

  const payeeType = fields.type === 'deposit' ? 'deposit' : 'withdrawal';
  const histories = useMerchantHistories(payeeType);

  const set = (patch: Partial<PlannedFields>) => setFields((f) => ({ ...f, ...patch }));
  const currency = currencyOf(currencies, fields.currencyCode);
  const problems = plannedProblems(fields);
  const accountName = (id: string | null, name: string | null) =>
    (id ? (assetAccounts.find((a) => a.id === id)?.name ?? name) : name) ?? '—';

  // Which end is the user's own account and which the payee/payer.
  const ownFrom = fields.type !== 'deposit';
  const ownTo = fields.type !== 'withdrawal';

  /**
   * A payee picked from history also fills what's usually booked with it — its category and the
   * account it's usually paid from — where the user hasn't chosen one.
   */
  function choosePayee(h: MerchantHistory) {
    const patch: Partial<PlannedFields> =
      fields.type === 'deposit'
        ? { sourceName: h.displayName, sourceId: null }
        : { destinationName: h.displayName, destinationId: null };
    if (!chosen.category && !fields.categoryName && h.topCategory)
      patch.categoryName = h.topCategory;
    const account =
      !chosen.account && h.topAccountName
        ? assetAccounts.find((a) => a.name === h.topAccountName)
        : undefined;
    if (account) {
      if (fields.type === 'deposit') {
        patch.destinationId = account.id;
        patch.destinationName = account.name;
      } else {
        patch.sourceId = account.id;
        patch.sourceName = account.name;
      }
    }
    set(patch);
  }

  /** The own account moves to the end the new type keeps it on; the payee/payer starts empty. */
  function changeType(type: TxType) {
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

  const next: PlannedFields = {
    ...fields,
    name: fields.name.trim(),
    tags: fields.tags,
  };
  // Save stays off until something differs from what Firefly III holds (or a queued save does).
  const unchanged = !!item && samePlannedFields(item.fields, next);
  const dirty = !!item && !unchanged;
  const close = useConfirmDiscard(dirty, 'planned.discardTitle');
  const onSave = act(tr('common.save'), async () => {
    if (problems.length > 0 || unchanged) return;
    await savePlanned(db, item, next);
    router.back();
  });
  const saving = act.pending(tr('common.save'));

  const deleteNow = act(tr('common.delete'), async () => {
    if (!item) return;
    await deletePlanned(db, item);
    router.back();
  });

  // Books the next occurrence ahead of its day (#44): testing a new recurrence, or paying one
  // early. Only once FF3 holds the recurring transaction — there is nothing to fire before that.
  const triggerNow = act(tr('planned.triggerNow'), async () => {
    if (!item) return;
    await triggerPlanned(db, item);
    router.back();
  });

  const chooseRemind = act(tr('planned.remind.title'), async (key: string) => {
    if (!item) return;
    // 'default' is no choice in REMIND_CHOICES, so it clears the override.
    const value = REMIND_CHOICES.find((x) => x === key) ?? null;
    await setReminderOverride(db, item.key, value);
    setRemind((r) => (r ? { ...r, override: value } : r));
    void syncPlannedNotifications(db);
  });

  /**
   * Firefly III has no way to miss a single occurrence — `active: false` pauses the whole
   * recurrence — so a skipped date is recorded in the recurring transaction's notes and the app
   * deletes the transaction as soon as FF3 books it. Queued as an ordinary save.
   */
  function onToggleSkip(day: string) {
    const skipping = !fields.skipDays.includes(day);
    const apply = () => set({ skipDays: toggleSkipDay(fields.skipDays, day, localDay()) });
    if (!skipping) {
      Alert.alert(tr('planned.unskipTitle', { date: dayLabel(day) }), undefined, [
        { text: tr('common.cancel'), style: 'cancel' },
        { text: tr('planned.unskip'), onPress: apply },
      ]);
      return;
    }
    Alert.alert(tr('planned.skipTitle', { date: dayLabel(day) }), tr('planned.skipBody'), [
      { text: tr('common.cancel'), style: 'cancel' },
      { text: tr('planned.skip'), style: 'destructive', onPress: apply },
    ]);
  }

  // "Skip this one" from a notification opens the item with the date: asked once, then not again.
  // No dependency list: the ref is the guard, and onToggleSkip is a new function each render.
  const skipHandled = useRef(false);
  useEffect(() => {
    if (!skipDay || skipHandled.current || !item) return;
    skipHandled.current = true;
    if (/^\d{4}-\d{2}-\d{2}$/.test(skipDay) && !fields.skipDays.includes(skipDay))
      onToggleSkip(skipDay);
  });

  function onTrigger() {
    if (!item) return;
    Alert.alert(
      tr('planned.triggerTitle', { name: item.fields.name }),
      tr('planned.triggerBody', { date: dayLabel(item.fields.date) }),
      [
        { text: tr('common.cancel'), style: 'cancel' },
        { text: tr('planned.triggerNow'), onPress: () => void triggerNow() },
      ],
    );
  }

  function onDelete() {
    if (!item) return;
    Alert.alert(tr('planned.deleteTitle', { name: item.fields.name }), tr('planned.deleteBody'), [
      { text: tr('common.cancel'), style: 'cancel' },
      {
        text: tr('common.delete'),
        style: 'destructive',
        onPress: () => void deleteNow(),
      },
    ]);
  }

  /** The rare actions behind the ••• : booking early and deleting. */
  function onMore() {
    if (!item) return;
    Alert.alert(item.fields.name, undefined, [
      ...(item.group?.recurrence ? [{ text: tr('planned.triggerNow'), onPress: onTrigger }] : []),
      { text: tr('common.delete'), style: 'destructive', onPress: onDelete },
      { text: tr('common.cancel'), style: 'cancel' },
    ]);
  }

  const scheduleText = [scheduleLabel(fields, item?.group), endLabel(fields.end, fields.repeats)]
    .filter(Boolean)
    .join(' · ');
  const amountText = currencyRows ? formatMoney(fields.amount, currency) : '';
  const remindText = !remind
    ? '—'
    : remind.override
      ? tr(`planned.remind.${remind.override}`)
      : tr('planned.remind.default', { when: tr(`planned.remind.${remind.when}`) });

  return (
    <Screen bottom avoidKeyboard>
      <PushHeader
        backLabel={tr('planned.title')}
        onBack={close}
        title={isNew ? tr('planned.newTitle') : fields.name || tr('planned.title')}
        subtitle={isNew ? undefined : [amountText, scheduleText].filter(Boolean).join(' · ')}
        right={item ? <MoreButton label={tr('planned.more')} onPress={onMore} /> : undefined}
      />
      <ScrollView
        contentContainerStyle={{ paddingTop: SCREEN_TOP_PADDING, paddingBottom: t.space.xxl }}
        keyboardShouldPersistTaps="handled"
      >
        <SectionHeader title={tr('planned.sectionPayment')} />
        <Card style={{ marginHorizontal: t.space.lg, gap: t.space.sm }}>
          <Segmented
            options={TX_TYPES.map((x) => ({ key: x.type, label: tr(x.labelKey) }))}
            value={fields.type}
            onChange={changeType}
            accessibilityLabel={tr('planned.sectionPayment')}
          />
          <Text style={[t.type.label, { color: t.color.textMuted }]}>{tr('planned.name')}</Text>
          <TextField
            value={fields.name}
            onChangeText={(name) => set({ name })}
            placeholder={tr('planned.namePlaceholder')}
          />
          <ListRow
            label={tr('fields.from')}
            value={
              ownFrom ? accountName(fields.sourceId, fields.sourceName) : (fields.sourceName ?? '—')
            }
            chevron
            onPress={() => setSheet(ownFrom ? 'own' : 'payee')}
          />
          <ListRow
            label={tr('fields.to')}
            value={
              ownTo
                ? accountName(fields.destinationId, fields.destinationName)
                : (fields.destinationName ?? '—')
            }
            chevron
            onPress={() => setSheet(ownTo ? 'ownTo' : 'payee')}
          />
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
            label={tr('fields.category')}
            value={fields.categoryName ?? '—'}
            chevron
            onPress={() => setSheet('category')}
          />
        </Card>
        <Text
          style={[
            t.type.label,
            { color: t.color.textMuted, paddingHorizontal: t.space.xl, paddingTop: t.space.sm },
          ]}
        >
          {tr('planned.amountHint')}
        </Text>

        <SectionHeader title={tr('planned.sectionWhen')} />
        <Card style={{ marginHorizontal: t.space.lg }}>
          <ListRow
            first
            label={tr('planned.repeats')}
            value={scheduleText}
            chevron
            onPress={() => setScheduleOpen(true)}
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
        {!!fields.time && (
          <Text
            style={[
              t.type.label,
              { color: t.color.textMuted, paddingHorizontal: t.space.xl, paddingTop: t.space.sm },
            ]}
          >
            {tr('planned.timeHint')}
          </Text>
        )}

        <OccurrenceRows
          repetitions={fields.repetitions}
          repeats={fields.repeats}
          date={fields.date}
          skipDays={fields.skipDays}
          recurrenceId={item?.group?.recurrence?.id ?? null}
          onToggleSkip={onToggleSkip}
        />

        <SectionHeader title={tr('planned.sectionExtras')} />
        <Card style={{ marginHorizontal: t.space.lg, gap: t.space.sm }}>
          {!!item && (
            <ListRow
              first
              label={tr('planned.remind.title')}
              value={remindText}
              chevron
              onPress={() => setSheet('remind')}
            />
          )}
          <Text style={[t.type.label, { color: t.color.textMuted }]}>{tr('fields.note')}</Text>
          <TextField
            value={fields.notes ?? ''}
            onChangeText={(notes) => set({ notes: notes || null })}
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
      </ScrollView>

      {(isNew || dirty) && (
        <SaveBar
          problemText={
            problems.length > 0
              ? tr('readiness.missing', {
                  fields: problems.map((p) => tr(`planned.problem.${p}`)).join(', '),
                })
              : null
          }
          saving={saving}
          disabled={saving || unchanged || problems.length > 0}
          onSave={onSave}
          summary={item ? tr('planned.changesSummary') : undefined}
          onUndo={item ? () => setFields(item.fields) : undefined}
        />
      )}

      <ScheduleSheet
        visible={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        group={item?.group}
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
          if (typed !== null) setFields((f) => ({ ...f, amount: typed }));
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
        onSelect={(code) => {
          if (code) set({ currencyCode: code });
        }}
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
      {!!remind && (
        <PickerSheet
          visible={sheet === 'remind'}
          onClose={() => setSheet(null)}
          title={tr('planned.remind.title')}
          options={[
            {
              key: 'default',
              label: tr('planned.remind.default', { when: tr(`planned.remind.${remind.when}`) }),
            },
            ...REMIND_CHOICES.map((k) => ({ key: k, label: tr(`planned.remind.${k}`) })),
          ]}
          selected={remind.override ?? 'default'}
          onSelect={(key) => {
            if (key) void chooseRemind(key);
          }}
        />
      )}
    </Screen>
  );
}
