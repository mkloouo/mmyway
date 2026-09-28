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
