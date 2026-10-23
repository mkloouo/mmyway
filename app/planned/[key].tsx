// One planned transaction in the simple view: its subscription, rule and recurring transaction
// edited together (src/planned/model.ts). Save queues it like any other change.
//
// A PUSH page: ‹ Planned in the header, the ••• for Book now and Delete, and the save bar only once
// something differs from what FF3 holds. The schedule is a sheet of its own (ScheduleSheet).
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useDb } from '../../src/providers/DbProvider';
import { useTheme } from '../../src/ui/theme';
// prettier-ignore
import { Card, MoreButton, PushHeader, ListRow, SCREEN_TOP_PADDING, Screen, SectionHeader, Segmented } from '../../src/ui/kit';
import { TextField } from '../../src/ui/TextField';
import { formatMoney } from '../../src/money/format';
import { useAction } from '../../src/ui/useAction';
import { useConfirmDiscard } from '../../src/ui/useConfirmDiscard';
import {
  getReminderOverrides,
  getReminderWhen,
  setReminderOverride,
  type ReminderWhen,
} from '../../src/settings/appSettings';
import { usePlanned } from '../../src/planned/usePlanned';
import { toggleSkipDay } from '../../src/planned/notes';
import {
  dayLabel,
  nextOccurrence,
  occurrenceLabel,
  scheduleLabel,
  scheduleSince,
} from '../../src/planned/labels';
import { OccurrenceRows } from '../../src/ui/OccurrenceRows';
import { deletePlanned, savePlanned, triggerPlanned } from '../../src/planned/actions';
import { syncPlannedNotifications } from '../../src/planned/notifications';
import type { PlannedItem } from '../../src/planned/items';
import { localDay } from '../../src/utils/day';
import { TX_TYPES } from '../../src/transactions/txTypes';
import { SaveBar } from '../../src/ui/SaveBar';
import { usePlannedForm } from '../../src/planned/usePlannedForm';
import { PlannedFormSheets } from '../../src/planned/PlannedFormSheets';
import { TimeRows } from '../../src/ui/TimeRows';
import { REMIND_CHOICES, remindLabel } from '../../src/planned/remind';

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
  return <PlannedEditor item={item} skipDay={typeof skip === 'string' ? skip : null} />;
}

function PlannedEditor({ item, skipDay }: { item: PlannedItem | null; skipDay: string | null }) {
  const isNew = !item;
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const act = useAction();

  const form = usePlannedForm(item);
  const {
    fields,
    set,
    setFields,
    setSheet,
    setScheduleOpen,
    changeType,
    currency,
    currencyRows,
    problems,
    accountName,
    ownFrom,
    ownTo,
    next,
    unchanged,
    dirty,
  } = form;

  const [remind, setRemind] = useState<{
    override: ReminderWhen | 'off' | null;
    when: ReminderWhen;
  } | null>(null);

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

  const triggerNow = act(tr('planned.triggerNow'), async () => {
    if (!item) return;
    await triggerPlanned(db, item);
    router.back();
  });

  const chooseRemind = act(tr('planned.remind.title'), async (key: string) => {
    if (!item) return;
    const value = REMIND_CHOICES.find((x) => x === key) ?? null;
    await setReminderOverride(db, item.key, value);
    setRemind((r) => (r ? { ...r, override: value } : r));
    void syncPlannedNotifications(db);
  });

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

  function onMore() {
    if (!item) return;
    Alert.alert(item.fields.name, undefined, [
      ...(item.group?.recurrence ? [{ text: tr('planned.triggerNow'), onPress: onTrigger }] : []),
      { text: tr('common.delete'), style: 'destructive', onPress: onDelete },
      { text: tr('common.cancel'), style: 'cancel' },
    ]);
  }

  const fromName =
    (ownFrom ? accountName(fields.sourceId, fields.sourceName) : fields.sourceName) || '—';
  const toName =
    (ownTo ? accountName(fields.destinationId, fields.destinationName) : fields.destinationName) ||
    '—';
  const fromToLabel = `${fromName} → ${toName}`;

  function onEditFromTo() {
    const isXfer = fields.type === 'transfer';
    const isWth = fields.type === 'withdrawal';
    Alert.alert(tr('planned.fromTo'), undefined, [
      {
        text: `${tr(isXfer || isWth ? 'fields.from' : 'fields.payer')}: ${fromName}`,
        onPress: () => setSheet(isXfer || isWth ? 'own' : 'payee'),
      },
      {
        text: `${tr(isXfer || !isWth ? 'fields.to' : 'fields.payee')}: ${toName}`,
        onPress: () => setSheet(isXfer || !isWth ? 'ownTo' : 'payee'),
      },
      { text: tr('common.cancel'), style: 'cancel' },
    ]);
  }

  const nextDay = nextOccurrence(fields);
  const sched = scheduleLabel(fields, item?.group);
  const scheduleNextLine = nextDay
    ? `${sched ? `${sched}. ` : ''}${tr('planned.nextOn', { date: occurrenceLabel(nextDay) })}.`
    : sched;
  const amountText = currencyRows ? formatMoney(fields.amount, currency) : '';
  const remindText = !remind
    ? '—'
    : remindLabel({ override: remind.override, when: remind.when, time: fields.time });

  return (
    <Screen bottom avoidKeyboard>
      <PushHeader
        backLabel={tr('planned.title')}
        onBack={close}
        right={item ? <MoreButton label={tr('planned.moreAria')} onPress={onMore} /> : undefined}
      />
      <View
        style={{
          paddingHorizontal: t.space.xl,
          paddingTop: t.space.xs,
          paddingBottom: t.space.sm,
          gap: t.space.xs,
        }}
      >
        <Text style={[t.type.largeTitle, { color: t.color.text }]}>
          {fields.name || tr('planned.title')}
        </Text>
        {!!amountText && (
          <Text style={[t.type.amount, { color: t.color.text }]}>
            {fields.type === 'withdrawal' ? `−${amountText}` : amountText}
          </Text>
        )}
        {!!scheduleNextLine && (
          <Text style={[t.type.body, { color: t.color.textMuted }]}>{scheduleNextLine}</Text>
        )}
      </View>
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
          />
          <Text style={[t.type.label, { color: t.color.textMuted }]}>{tr('fields.name')}</Text>
          <TextField
            value={fields.name}
            onChangeText={(name) => set({ name })}
            placeholder={tr('planned.namePlaceholder')}
          />
          <ListRow sub={tr('planned.fromTo')} label={fromToLabel} chevron onPress={onEditFromTo} />
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
            value={fields.categoryName ?? tr('fields.noCategory')}
            chevron
            onPress={() => setSheet('category')}
          />
        </Card>

        <SectionHeader title={tr('planned.schedule')} />
        <Card style={{ marginHorizontal: t.space.lg, gap: t.space.sm }}>
          <ListRow
            first
            label={scheduleLabel(fields, item?.group)}
            sub={scheduleSince(fields) || undefined}
            chevron
            onPress={() => setScheduleOpen(true)}
          />
          <TimeRows time={fields.time} onChange={(time) => set({ time })} />
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
          sourceAccountId={fields.sourceId}
          onToggleSkip={onToggleSkip}
        />

        <SectionHeader title={tr('planned.sectionExtras')} />
        <Card flush style={{ marginHorizontal: t.space.lg }}>
          {!!item && (
            <ListRow
              first
              label={tr('planned.remind.title')}
              value={remindText}
              chevron
              onPress={() => setSheet('remind')}
            />
          )}
          <ListRow
            first={!item}
            label={tr('fields.note')}
            value={fields.notes || undefined}
            chevron
            onPress={() => setSheet('note')}
          />
          <ListRow
            label={tr('fields.tags')}
            value={fields.tags.length > 0 ? fields.tags.join(', ') : undefined}
            chevron
            onPress={() => setSheet('tags')}
          />
          {!!item && (
            <ListRow
              label={tr('planned.howFf3StoresIt')}
              sub={tr('planned.howFf3StoresItSub')}
              chevron
              onPress={() =>
                router.push({
                  pathname: '/planned/object/[key]',
                  params: { key: encodeURIComponent(item.key) },
                })
              }
            />
          )}
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

      <PlannedFormSheets
        form={form}
        group={item?.group}
        remind={remind}
        onChooseRemind={chooseRemind}
      />
    </Screen>
  );
}
