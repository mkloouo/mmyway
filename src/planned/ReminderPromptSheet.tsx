// The first-time reminder sheet, shown once after the first planned payment is saved while
// reminders are off. Also the notification preview card the Reminders settings page shares, and
// the OS permission request both use. Nothing here is shown anywhere yet except by its caller.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, Text, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useDb } from '../providers/DbProvider';
import { useCurrencies } from '../db/useReferenceData';
import { useTheme } from '../ui/theme';
import { Button, Sheet } from '../ui/kit';
import { useAction } from '../ui/useAction';
import { syncPlannedNotifications } from './notifications';
import {
  DEFAULT_REMINDER_TIME,
  getPlannedNotificationsEnabled,
  getReminderPromptShown,
  getReminderTime,
  setPlannedNotificationsEnabled,
  setReminderPromptShown,
  setReminderWhen,
  type ReminderWhen,
} from '../settings/appSettings';
import type { OutboxDb } from '../sync/outbox';

/** Asks the OS once it hasn't been granted; true when notifications may be shown. */
export async function requestNotificationPermission(): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status === 'granted') return true;
  const req = await Notifications.requestPermissionsAsync();
  return req.status === 'granted';
}

/** The sheet is due once, and only while reminders are off: a user who already chose has seen it. */
export async function shouldShowReminderPrompt(db: OutboxDb): Promise<boolean> {
  return !(await getReminderPromptShown(db)) && !(await getPlannedNotificationsEnabled(db));
}

const PREVIEW_TITLE: Record<ReminderWhen, string> = {
  day: 'reminders.previewDay',
  dayBefore: 'reminders.previewDayBefore',
  fewDays: 'reminders.previewFewDays',
  week: 'reminders.previewWeek',
};

/** What a reminder notification looks like, with example text; the day word and time follow `when` and `time`. */
export function ReminderPreview({
  when,
  time,
  name,
  account,
  caption,
}: {
  when: ReminderWhen;
  time: string;
  name: string;
  account: string;
  caption?: string;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  return (
    <View style={{ backgroundColor: t.color.text, borderRadius: 18, padding: 14 }}>
      <View
        style={{
          backgroundColor: t.color.surface,
          borderRadius: 14,
          padding: 10,
          flexDirection: 'row',
          gap: 10,
        }}
      >
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            backgroundColor: t.color.accent,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="checkmark" size={18} color={t.color.onAccent} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <Text style={[t.type.label, { color: t.color.text }]}>
            {tr(PREVIEW_TITLE[when], { name, time })}
          </Text>
          <Text style={[t.type.label, { color: t.color.textMuted }]}>
            {tr('reminders.previewBody', { account })}
          </Text>
        </View>
      </View>
      {!!caption && (
        <Text
          style={[t.type.label, { color: t.color.textFaint, textAlign: 'center', paddingTop: 8 }]}
        >
          {caption}
        </Text>
      )}
    </View>
  );
}

type PromptWhen = Extract<ReminderWhen, 'day' | 'dayBefore' | 'week'>;
const CHOICES: readonly PromptWhen[] = ['day', 'dayBefore', 'week'];
const CHOICE_LABEL: Record<PromptWhen, string> = {
  day: 'reminders.promptOnDay',
  dayBefore: 'reminders.promptDayBefore',
  week: 'reminders.promptWeekBefore',
};

export function ReminderPromptSheet({
  visible,
  plannedName,
  accountName,
  onDone,
}: {
  visible: boolean;
  plannedName: string;
  /** Omitted: the sheet doesn't promise a warning about the account. */
  accountName?: string;
  /** After either choice: the caller goes on with what it was doing. */
  onDone: () => void;
}) {
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const act = useAction();
  const currencies = useCurrencies();
  const [choice, setChoice] = useState<PromptWhen>('dayBefore');
  const [time, setTime] = useState(DEFAULT_REMINDER_TIME);

  useEffect(() => {
    if (visible) void getReminderTime(db).then(setTime);
  }, [db, visible]);

  const account = accountName ?? tr('reminders.exampleAccount');

  // Settings first, then the OS permission: the schedule is only rebuilt after both are in place.
  // Denied, the reminders stay off, the same as the Settings switch.
  const turnOn = act(tr('reminders.turnOn'), async () => {
    await setReminderWhen(db, choice);
    await setPlannedNotificationsEnabled(db, true);
    if (!(await requestNotificationPermission())) {
      await setPlannedNotificationsEnabled(db, false);
      Alert.alert(tr('reminders.title'), tr('settings.notificationsPermissionDenied'));
    }
    await syncPlannedNotifications(db, currencies);
    await setReminderPromptShown(db, true);
    onDone();
  });

  // Not now, the scrim and Android back all dismiss it for good: it is asked once.
  const notNow = act(tr('reminders.notNow'), async () => {
    await setReminderPromptShown(db, true);
    onDone();
  });

  return (
    <Sheet
      visible={visible}
      scroll={false}
      onClose={() => void notNow()}
      title={tr('reminders.promptTitle', { name: plannedName })}
      footer={
        <View style={{ gap: t.space.sm }}>
          <Button title={tr('reminders.turnOn')} onPress={() => void turnOn()} />
          <Button title={tr('reminders.notNow')} variant="ghost" onPress={() => void notNow()} />
        </View>
      }
    >
      <Text style={[t.type.body, { color: t.color.textMuted }]}>
        {accountName
          ? tr('reminders.promptBody', { account })
          : tr('reminders.promptBodyNoAccount')}
      </Text>
      <ReminderPreview when={choice} time={time} name={plannedName} account={account} />
      <Text style={[t.type.label, { color: t.color.textMuted }]}>
        {tr('reminders.promptRemindMe')}
      </Text>
      <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: t.space.sm }}>
        {CHOICES.map((c) => {
          const on = c === choice;
          return (
            <Pressable
              key={c}
              onPress={() => setChoice(c)}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              style={{
                flex: 1,
                borderRadius: t.radius.md,
                borderWidth: on ? 2 : 1,
                borderColor: on ? t.color.accent : t.color.border,
                backgroundColor: on ? t.color.accentSoft : t.color.surface,
                padding: 12,
                gap: 2,
              }}
            >
              <Text style={[t.type.body, { color: t.color.text, fontWeight: '600' }]}>
                {tr(CHOICE_LABEL[c])}
              </Text>
              <Text style={[t.type.label, { color: t.color.textMuted }]}>
                {tr('reminders.promptAt', { time })}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}
