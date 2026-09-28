// The one place the app opens the system date picker. Android shows its own dialog; the app ships
// only for Android today (review: "Android-only APIs"), so an iOS build needs one change here —
// an inline <DateTimePicker> in a Sheet — instead of one per screen.
import { Platform } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { logLine } from '../utils/log';

export function pickDate(value: Date, onPick: (picked: Date) => void): void {
  if (Platform.OS !== 'android') {
    logLine('warn', `pickDate: no date picker on ${Platform.OS} yet`);
    return;
  }
  DateTimePickerAndroid.open({
    value,
    mode: 'date',
    onChange: (event: { type: string }, picked?: Date) => {
      if (event.type === 'set' && picked) onPick(picked);
    },
  });
}

/**
 * The date, then the time: the time dialog opens as soon as a day is picked, starting from
 * `value`'s time. Cancelling the time keeps the new day at the old time; cancelling the date
 * changes nothing.
 */
export function pickDateTime(value: Date, onPick: (picked: Date) => void): void {
  pickDate(value, (day) => {
    const withDay = new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate(),
      value.getHours(),
      value.getMinutes(),
      value.getSeconds(),
    );
    if (Platform.OS !== 'android') {
      onPick(withDay);
      return;
    }
    DateTimePickerAndroid.open({
      value: withDay,
      mode: 'time',
      onChange: (event: { type: string }, picked?: Date) => {
        if (event.type === 'set' && picked) {
          onPick(
            new Date(
              withDay.getFullYear(),
              withDay.getMonth(),
              withDay.getDate(),
              picked.getHours(),
              picked.getMinutes(),
              0,
            ),
          );
        } else {
          onPick(withDay);
        }
      },
    });
  });
}

/** The system time dialog alone ("HH:MM" in, "HH:MM" out); cancelling changes nothing. */
export function pickTime(value: string | null, onPick: (time: string) => void): void {
  if (Platform.OS !== 'android') {
    logLine('warn', `pickTime: no time picker on ${Platform.OS} yet`);
    return;
  }
  const [h, m] = (value ?? '09:00').split(':').map(Number);
  const start = new Date();
  start.setHours(h ?? 9, m ?? 0, 0, 0);
  DateTimePickerAndroid.open({
    value: start,
    mode: 'time',
    onChange: (event: { type: string }, picked?: Date) => {
      if (event.type === 'set' && picked)
        onPick(
          `${String(picked.getHours()).padStart(2, '0')}:${String(picked.getMinutes()).padStart(2, '0')}`,
        );
    },
  });
}
