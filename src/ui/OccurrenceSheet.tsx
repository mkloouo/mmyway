// One occurrence of a planned transaction, opened from the Planned tab's "Coming up" list. A Review
// sheet: the amount, its status rows and one primary action. Skip and Book it now ask first, then
// queue through the same calls as the planned transaction's own screen (app/planned/[key].tsx).
// A booked occurrence has nothing left to book, so its Book it now is hidden.
import { useTranslation } from 'react-i18next';
import { Alert, View } from 'react-native';
import { useDb } from '../providers/DbProvider';
import { useCurrencies } from '../db/useReferenceData';
import { useTheme } from './theme';
import { Button, Card, Money, Row, Sheet } from './kit';
import { currencyOf } from './money';
import { useAction } from './useAction';
import { navigateOnce } from './navigateOnce';
import { savePlanned, triggerPlanned } from '../planned/actions';
import type { PlannedItem } from '../planned/items';
import { dayLabel } from '../planned/labels';
import { toggleSkipDay } from '../planned/notes';
import { localDay } from '../utils/day';

export interface Occurrence {
  item: PlannedItem;
  /** YYYY-MM-DD */
  day: string;
  skipped: boolean;
}

export function OccurrenceSheet({
  visible,
  occurrence,
  booked,
  onClose,
}: {
  visible: boolean;
  occurrence: Occurrence | null;
  /** FF3 already booked this day's occurrence (the Planned tab's "Booked" badge). */
  booked: boolean;
  onClose: () => void;
}) {
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const act = useAction();
  const currencies = useCurrencies();
  if (!occurrence) return null;
  const { item, day, skipped } = occurrence;
  const f = item.fields;
  const name = f.name;
  // Any occurrence of a recurring item can be booked: FF3 fires the recurrence for that date alone.
  // A skipped day is deleted again by the skip rule when FF3 books it, so booking it is pointless.
  const canBook = !!item.group?.recurrence && !skipped;

  const toggleLabel = skipped ? tr('planned.unskip') : tr('planned.skip');
  const toggleNow = act(toggleLabel, async () => {
    await savePlanned(db, item, {
      ...f,
      skipDays: toggleSkipDay(f.skipDays, day, localDay()),
    });
    onClose();
  });
  const toggleLoading = act.pending(toggleLabel);

  const bookNow = act(tr('planned.triggerNow'), async () => {
    await triggerPlanned(db, item, day);
    onClose();
  });
  const bookLoading = act.pending(tr('planned.triggerNow'));

  // Same prompts as the planned transaction's own screen. A skipped date is put back without the
  // "no way to miss one" explanation, which is about skipping.
  function onToggle() {
    if (skipped) {
      Alert.alert(tr('planned.unskipTitle', { date: dayLabel(day) }), undefined, [
        { text: tr('common.cancel'), style: 'cancel' },
        { text: tr('planned.unskip'), onPress: () => void toggleNow() },
      ]);
      return;
    }
    Alert.alert(
      tr('planned.occurrence.skipTitle', { name, date: dayLabel(day) }),
      tr('planned.skipBody'),
      [
        { text: tr('common.cancel'), style: 'cancel' },
        {
          text: tr('planned.occurrence.skipVerb'),
          style: 'destructive',
          onPress: () => void toggleNow(),
        },
      ],
    );
  }

  function onBook() {
    Alert.alert(
      tr('planned.triggerTitle', { name }),
      tr('planned.triggerBody', { date: dayLabel(day) }),
      [
        { text: tr('common.cancel'), style: 'cancel' },
        { text: tr('planned.triggerNow'), onPress: () => void bookNow() },
      ],
    );
  }

  return (
    <Sheet
      visible={visible}
      title={name}
      onClose={onClose}
      footer={
        <View style={{ flexDirection: 'row', gap: t.space.sm }}>
          <Button
            variant="secondary"
            size="lg"
            title={toggleLabel}
            disabled={toggleLoading}
            onPress={onToggle}
            style={{ flex: 1 }}
          />
          {!booked && (
            <Button
              variant="primary"
              size="lg"
              title={tr('planned.triggerNow')}
              disabled={!canBook || bookLoading}
              onPress={onBook}
              style={{ flex: 1 }}
            />
          )}
        </View>
      }
    >
      <Money
        amount={f.amount}
        currency={currencyOf(currencies, f.currencyCode)}
        type={f.type}
        size="display"
      />
      <Card>
        <Row first label={tr('fields.date')} value={dayLabel(day)} />
        <Row label={tr('fields.from')} value={f.sourceName ?? '—'} />
        <Row label={tr('fields.to')} value={f.destinationName ?? '—'} />
        <Row label={tr('fields.category')} value={f.categoryName ?? '—'} />
        <Row
          label={tr('planned.occurrence.status')}
          value={
            skipped
              ? tr('planned.occurrence.skipped')
              : booked
                ? tr('planned.occurrence.booked')
                : tr('planned.occurrence.scheduled')
          }
        />
      </Card>
      <Button
        variant="ghost"
        title={tr('planned.occurrence.edit')}
        onPress={() => {
          onClose();
          navigateOnce(`/planned/${encodeURIComponent(item.key)}`);
        }}
      />
    </Sheet>
  );
}
