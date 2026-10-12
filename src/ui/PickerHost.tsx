// The iOS stand-in for the system date and time dialogs that pickDate.ts opens on Android. iOS has
// no such dialog, so each request lands here: one Sheet with an inline spinner. Mounted once, in
// app/_layout.tsx.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Button, Sheet } from './components';
import { useTheme } from './theme';

type PickerRequest = {
  mode: 'date' | 'time' | 'datetime';
  value: Date;
  onPick: (picked: Date) => void;
};

let show: ((req: PickerRequest) => void) | null = null;

/** Opens the mounted PickerHost. False when none is mounted, so the caller can say so. */
export function requestPicker(req: PickerRequest): boolean {
  if (!show) return false;
  show(req);
  return true;
}

export function PickerHost() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const [req, setReq] = useState<PickerRequest | null>(null);
  const [draft, setDraft] = useState<Date>(() => new Date());
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const open = (next: PickerRequest) => {
      setDraft(next.value);
      setReq(next);
      setVisible(true);
    };
    show = open;
    return () => {
      if (show === open) show = null;
    };
  }, []);

  // Each spinner replaces only its own part of the draft, so a datetime sheet keeps the day
  // when the time moves and the other way round.
  const onDay = (_event: unknown, day?: Date) => {
    if (!day) return;
    setDraft(
      (d) =>
        new Date(
          day.getFullYear(),
          day.getMonth(),
          day.getDate(),
          d.getHours(),
          d.getMinutes(),
          d.getSeconds(),
        ),
    );
  };
  const onClock = (_event: unknown, clock?: Date) => {
    if (!clock) return;
    setDraft(
      (d) =>
        new Date(
          d.getFullYear(),
          d.getMonth(),
          d.getDate(),
          clock.getHours(),
          clock.getMinutes(),
          d.getSeconds(),
        ),
    );
  };

  const title =
    req?.mode === 'time'
      ? tr('pickerHost.timeTitle')
      : req?.mode === 'datetime'
        ? tr('pickerHost.dateTimeTitle')
        : tr('pickerHost.dateTitle');

  return (
    <Sheet
      visible={visible}
      title={title}
      onClose={() => setVisible(false)}
      footer={
        <Button
          title={tr('common.done')}
          onPress={() => {
            req?.onPick(draft);
            setVisible(false);
          }}
        />
      }
    >
      {req?.mode !== 'time' && (
        <DateTimePicker
          mode="date"
          display="spinner"
          value={draft}
          onChange={onDay}
          themeVariant={t.dark ? 'dark' : 'light'}
          textColor={t.color.text}
        />
      )}
      {req?.mode !== 'date' && (
        <DateTimePicker
          mode="time"
          display="spinner"
          value={draft}
          onChange={onClock}
          themeVariant={t.dark ? 'dark' : 'light'}
          textColor={t.color.text}
        />
      )}
    </Sheet>
  );
}
