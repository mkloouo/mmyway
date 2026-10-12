// The one place the app opens the date and time pickers. Android shows its own dialog; iOS has none,
// so the request goes to the mounted PickerHost sheet (src/ui/PickerHost.tsx) instead of one picker
// per screen.
import { Platform } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { logLine } from '../utils/log';
import { requestPicker } from './PickerHost';

export function pickDate(value: Date, onPick: (picked: Date) => void): void {
  if (Platform.OS !== 'android') {
    if (!requestPicker({ mode: 'date', value, onPick }))
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
 * changes nothing. On iOS both spinners sit in one sheet.
 */
export function pickDateTime(value: Date, onPick: (picked: Date) => void): void {
  if (Platform.OS !== 'android') {
    if (!requestPicker({ mode: 'datetime', value, onPick }))
      logLine('warn', `pickDate: no date picker on ${Platform.OS} yet`);
    return;
  }
  pickDate(value, (day) => {
    const withDay = new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate(),
      value.getHours(),
      value.getMinutes(),
      value.getSeconds(),
    );
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

/** The time picker alone ("HH:MM" in, "HH:MM" out); cancelling changes nothing. */
export function pickTime(value: string | null, onPick: (time: string) => void): void {
  const [h, m] = (value ?? '09:00').split(':').map(Number);
  const start = new Date();
  start.setHours(h ?? 9, m ?? 0, 0, 0);
  const hhmm = (d: Date) =>
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (Platform.OS !== 'android') {
    if (!requestPicker({ mode: 'time', value: start, onPick: (picked) => onPick(hhmm(picked)) }))
      logLine('warn', `pickTime: no time picker on ${Platform.OS} yet`);
    return;
  }
  DateTimePickerAndroid.open({
    value: start,
    mode: 'time',
    onChange: (event: { type: string }, picked?: Date) => {
      if (event.type === 'set' && picked) onPick(hhmm(picked));
    },
  });
}
