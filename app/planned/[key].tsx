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
import { useTheme } from '../../src/ui/theme';
// prettier-ignore
import { Card, MoreButton, PushHeader, ListRow, SCREEN_TOP_PADDING, Screen, SectionHeader, Segmented } from '../../src/ui/kit';
import { TextField } from '../../src/ui/TextField';
import { TagsField } from '../../src/ui/TagsField';
import { formatMoney } from '../../src/money/format';
import { useAction } from '../../src/ui/useAction';
import { useConfirmDiscard } from '../../src/ui/useConfirmDiscard';
import { useRecentTags } from '../../src/lookup/recentTags';
import {
  getReminderOverrides,
  getReminderWhen,
  setReminderOverride,
  type ReminderWhen,
} from '../../src/settings/appSettings';
import { usePlanned } from '../../src/planned/usePlanned';
import { toggleSkipDay } from '../../src/planned/notes';
import { dayLabel, endLabel, scheduleLabel } from '../../src/planned/labels';
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
  const recentTags = useRecentTags();

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

  const scheduleText = [scheduleLabel(fields, item?.group), endLabel(fields.end, fields.repeats)]
    .filter(Boolean)
    .join(' · ');
  const amountText = currencyRows ? formatMoney(fields.amount, currency) : '';
  const remindText = !remind
    ? '—'
    : remindLabel({ override: remind.override, when: remind.when, time: fields.time });

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
          />
          <Text style={[t.type.label, { color: t.color.textMuted }]}>{tr('fields.name')}</Text>
          <TextField
            value={fields.name}
            onChangeText={(name) => set({ name })}
            placeholder={tr('planned.namePlaceholder')}
          />
          <ListRow
            label={tr(ownFrom ? 'fields.from' : 'fields.payee')}
            value={
              (ownFrom ? accountName(fields.sourceId, fields.sourceName) : fields.sourceName) ??
              undefined
            }
            chevron
            onPress={() => setSheet(ownFrom ? 'own' : 'payee')}
          />
          <ListRow
            label={tr(ownTo ? 'fields.to' : 'fields.payer')}
            value={
              (ownTo
                ? accountName(fields.destinationId, fields.destinationName)
                : fields.destinationName) ?? undefined
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
            value={fields.categoryName ?? tr('fields.noCategory')}
            chevron
            onPress={() => setSheet('category')}
          />
        </Card>

        <SectionHeader title={tr('planned.sectionWhen')} />
        <Card style={{ marginHorizontal: t.space.lg, gap: t.space.sm }}>
          <ListRow
            first
            label={tr('planned.repeats')}
            value={scheduleText}
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

      <PlannedFormSheets
        form={form}
        group={item?.group}
        remind={remind}
        onChooseRemind={chooseRemind}
      />
    </Screen>
  );
}
