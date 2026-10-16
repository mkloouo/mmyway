// Settings → Reminders: when planned payments are announced, which ones, and how much noise they
// make. Every change is written through the same setters the scheduler reads, then the
// notifications are rescheduled at once. Turning reminders on asks the OS for permission first,
// as the Settings switch did.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDb } from '../../src/providers/DbProvider';
import { useCurrencies } from '../../src/db/useReferenceData';
import { useTheme } from '../../src/ui/theme';
import {
  Button,
  Card,
  GroupFooter,
  ListRow,
  PushHeader,
  RadioRow,
  SCREEN_TOP_PADDING,
  Screen,
  SectionHeader,
  Sheet,
  SwitchRow,
} from '../../src/ui/kit';
import { TextField } from '../../src/ui/TextField';
import { useAction } from '../../src/ui/useAction';
import { pickTime } from '../../src/ui/pickDate';
import { currencyOf } from '../../src/ui/money';
import { parseDecimalInput } from '../../src/api/ff3/decimal';
import { syncPlannedNotifications } from '../../src/planned/notifications';
import {
  ReminderPreview,
  requestNotificationPermission,
} from '../../src/planned/ReminderPromptSheet';
import { SETTINGS_QUERY_KEY } from '../../src/settings/loadSettings';
import {
  DEFAULT_REMINDER_TIME,
  getDefaultCurrencyCode,
  getPlannedNotificationsEnabled,
  getReminderDigest,
  getReminderFilter,
  getReminderMinAmount,
  getReminderNudgeOnDay,
  getReminderTime,
  getReminderWarnShort,
  getReminderWhen,
  setPlannedNotificationsEnabled,
  setReminderDigest,
  setReminderFilter,
  setReminderMinAmount,
  setReminderNudgeOnDay,
  setReminderTime,
  setReminderWarnShort,
  setReminderWhen,
  type ReminderFilter,
  type ReminderWhen,
} from '../../src/settings/appSettings';
import type { OutboxDb } from '../../src/sync/outbox';

const REMINDERS_QUERY_KEY = ['reminders'] as const;

async function loadReminders(db: OutboxDb) {
  const [enabled, when, time, nudgeOnDay, filter, minAmount, digest, warnShort, currency] =
    await Promise.all([
      getPlannedNotificationsEnabled(db),
      getReminderWhen(db),
      getReminderTime(db),
      getReminderNudgeOnDay(db),
      getReminderFilter(db),
      getReminderMinAmount(db),
      getReminderDigest(db),
      getReminderWarnShort(db),
      getDefaultCurrencyCode(db),
    ]);
  return { enabled, when, time, nudgeOnDay, filter, minAmount, digest, warnShort, currency };
}

export default function RemindersScreen() {
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const act = useAction();
  const queryClient = useQueryClient();
  const currencies = useCurrencies();

  const { data } = useQuery({
    queryKey: REMINDERS_QUERY_KEY,
    queryFn: () => loadReminders(db),
  });

  const [sheet, setSheet] = useState<'time' | 'minAmount' | null>(null);
  const [draftTime, setDraftTime] = useState(DEFAULT_REMINDER_TIME);
  const [draftMinAmount, setDraftMinAmount] = useState('');

  /** Re-reads this page and the Settings page's copy of the on/off switch. */
  const reload = () => {
    void queryClient.invalidateQueries({ queryKey: REMINDERS_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });
  };

  /**
   * Writes one setting, then re-reads and reschedules. Each setting has its own name for the
   * in-flight guard, so a quick tap on a different row isn't dropped as a double tap.
   */
  const change = (label: string, write: () => Promise<void>) =>
    act(label, async () => {
      await write();
      reload();
      await syncPlannedNotifications(db, currencies);
    })();

  const toggleEnabled = (next: boolean) =>
    void act(tr('reminders.enabled'), async () => {
      if (next && !(await requestNotificationPermission())) {
        Alert.alert(tr('reminders.title'), tr('settings.notificationsPermissionDenied'));
        return;
      }
      await setPlannedNotificationsEnabled(db, next);
      reload();
      await syncPlannedNotifications(db, currencies);
    })();

  const pickWhen = (when: ReminderWhen) =>
    void change(tr('reminders.when'), () => setReminderWhen(db, when));

  const pickFilter = (filter: ReminderFilter) =>
    void change(tr('reminders.which'), () => setReminderFilter(db, filter));

  const openTime = () => {
    setDraftTime(data?.time ?? DEFAULT_REMINDER_TIME);
    setSheet('time');
  };
  const openMinAmount = () => {
    setDraftMinAmount(data?.minAmount ?? '');
    setSheet('minAmount');
  };

  // The default currency's symbol, for "over 200 zł". Falls back to FF3's primary currency.
  const currencyCode = data?.currency ?? currencies.find((c) => c.isDefault)?.code ?? null;
  const symbol = currencyCode ? currencyOf(currencies, currencyCode).symbol : '';

  const when = data?.when ?? 'dayBefore';
  const filter = data?.filter ?? 'all';

  return (
    <Screen bottom>
      <PushHeader backLabel={tr('settings.title')} onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={{ paddingTop: SCREEN_TOP_PADDING, paddingBottom: t.space.xxl }}
      >
        <Text
          style={[
            t.type.largeTitle,
            { color: t.color.text, paddingHorizontal: t.space.xl, paddingBottom: t.space.xs },
          ]}
        >
          {tr('reminders.title')}
        </Text>
        <Text
          style={[
            t.type.body,
            { color: t.color.textMuted, paddingHorizontal: t.space.xl, paddingBottom: t.space.md },
          ]}
        >
          {tr('reminders.intro')}
        </Text>

        <View style={{ paddingHorizontal: t.space.lg, paddingBottom: t.space.md }}>
          <ReminderPreview
            when={when}
            time={data?.time ?? DEFAULT_REMINDER_TIME}
            name={tr('reminders.exampleName')}
            account={tr('reminders.exampleAccount')}
            caption={tr('reminders.previewCaption')}
          />
        </View>

        <Card flush style={{ marginHorizontal: t.space.lg }}>
          <SwitchRow
            first
            bold
            label={tr('reminders.enabled')}
            value={data?.enabled ?? false}
            onValueChange={toggleEnabled}
          />
        </Card>

        {data?.enabled && (
          <>
            <SectionHeader title={tr('reminders.when')} />
            <Card flush style={{ marginHorizontal: t.space.lg }}>
              <RadioRow
                first
                label={tr('reminders.whenDay')}
                selected={when === 'day'}
                onPress={() => pickWhen('day')}
              />
              <RadioRow
                label={tr('reminders.whenDayBefore')}
                selected={when === 'dayBefore'}
                onPress={() => pickWhen('dayBefore')}
              />
              <RadioRow
                label={tr('reminders.whenFewDays')}
                sub={tr('reminders.whenFewDaysSub')}
                selected={when === 'fewDays'}
                onPress={() => pickWhen('fewDays')}
              />
              <RadioRow
                label={tr('reminders.whenWeek')}
                selected={when === 'week'}
                onPress={() => pickWhen('week')}
              />
            </Card>

            <Card flush style={{ marginHorizontal: t.space.lg, marginTop: t.space.md }}>
              <ListRow
                first
                label={tr('reminders.at')}
                trailing={
                  <Text style={[t.type.body, { color: t.color.textMuted }]}>{data.time}</Text>
                }
                chevron
                onPress={openTime}
              />
              {when !== 'day' && (
                <SwitchRow
                  label={tr('reminders.nudge')}
                  hint={tr('reminders.nudgeHint')}
                  value={data.nudgeOnDay}
                  onValueChange={(v) =>
                    void change(tr('reminders.nudge'), () => setReminderNudgeOnDay(db, v))
                  }
                />
              )}
            </Card>

            <SectionHeader title={tr('reminders.which')} />
            <Card flush style={{ marginHorizontal: t.space.lg }}>
              <RadioRow
                first
                label={tr('reminders.whichAll')}
                selected={filter === 'all'}
                onPress={() => pickFilter('all')}
              />
              <RadioRow
                label={tr('reminders.whichBigger')}
                sub={tr('reminders.whichBiggerSub', { amount: data.minAmount, symbol })}
                selected={filter === 'bigger'}
                onPress={() => (filter === 'bigger' ? openMinAmount() : pickFilter('bigger'))}
              />
              <RadioRow
                label={tr('reminders.whichOutgoing')}
                selected={filter === 'outgoing'}
                onPress={() => pickFilter('outgoing')}
              />
            </Card>

            <SectionHeader title={tr('reminders.less')} />
            <Card flush style={{ marginHorizontal: t.space.lg }}>
              <SwitchRow
                first
                label={tr('reminders.digest')}
                hint={tr('reminders.digestHint')}
                value={data.digest}
                onValueChange={(v) =>
                  void change(tr('reminders.digest'), () => setReminderDigest(db, v))
                }
              />
              <SwitchRow
                label={tr('reminders.warnShort')}
                hint={tr('reminders.warnShortHint')}
                value={data.warnShort}
                onValueChange={(v) =>
                  void change(tr('reminders.warnShort'), () => setReminderWarnShort(db, v))
                }
              />
            </Card>
            <GroupFooter>{tr('reminders.footer')}</GroupFooter>
          </>
        )}
      </ScrollView>

      <Sheet
        visible={sheet === 'time'}
        onClose={() => setSheet(null)}
        title={tr('reminders.timeTitle')}
        footer={
          <Button
            title={tr('common.save')}
            onPress={() =>
              void change(tr('reminders.timeTitle'), async () => {
                await setReminderTime(db, draftTime);
                setSheet(null);
              })
            }
          />
        }
      >
        <Card flush>
          <ListRow
            first
            label={tr('reminders.at')}
            trailing={<Text style={[t.type.body, { color: t.color.textMuted }]}>{draftTime}</Text>}
            chevron
            onPress={() => pickTime(draftTime, setDraftTime)}
          />
        </Card>
      </Sheet>

      <Sheet
        visible={sheet === 'minAmount'}
        onClose={() => setSheet(null)}
        title={tr('reminders.minAmountTitle')}
        footer={
          <Button
            title={tr('common.save')}
            disabled={!parseDecimalInput(draftMinAmount).ok}
            onPress={() =>
              void change(tr('reminders.minAmountTitle'), async () => {
                await setReminderMinAmount(db, draftMinAmount);
                setSheet(null);
              })
            }
          />
        }
      >
        <Card>
          <TextField
            value={draftMinAmount}
            onChangeText={setDraftMinAmount}
            keyboardType="decimal-pad"
          />
        </Card>
      </Sheet>
    </Screen>
  );
}
