import { useTranslation } from 'react-i18next';
import { PickerSheet } from './PickerSheet';
import type { Repetition } from '../planned/repetition';
import {
  ndomMoment,
  parseNdom,
  REPETITION_TYPES,
  WEEKEND_RULES,
  momentFor,
} from '../planned/repetition';
import { repetitionTypeName, weekdayName, weekendName } from '../planned/labels';

export type PickerKind = 'dayOfMonth' | 'weekend' | 'weekday' | 'nth' | 'repType' | null;

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => String(from + i));

export function SchedulePickers({
  pickerKind,
  onClose,
  pickerIndex,
  dayOfMonth,
  repetitions,
  date,
  patchRow,
}: {
  pickerKind: PickerKind;
  onClose: () => void;
  pickerIndex: number;
  dayOfMonth: number;
  repetitions: Repetition[];
  date: string;
  patchRow: (index: number, patch: Partial<Repetition>) => void;
}) {
  const { t: tr } = useTranslation();

  return (
    <>
      <PickerSheet
        visible={pickerKind === 'dayOfMonth'}
        onClose={onClose}
        title={tr('planned.dayOfMonthLabel')}
        options={range(1, 31).map((d) => ({ key: d, label: d }))}
        selected={String(dayOfMonth)}
        onSelect={(key) => {
          if (key) patchRow(pickerIndex, { moment: key });
          onClose();
        }}
      />
      <PickerSheet
        visible={pickerKind === 'weekend'}
        onClose={onClose}
        title={tr('planned.ifFallsOnWeekend')}
        options={WEEKEND_RULES.map((w) => ({ key: String(w), label: weekendName(w) }))}
        selected={String(repetitions[pickerIndex]?.weekend ?? 1)}
        onSelect={(key) => {
          if (key) {
            const w = WEEKEND_RULES.find((x) => String(x) === key);
            if (w) patchRow(pickerIndex, { weekend: w });
          }
          onClose();
        }}
      />
      <PickerSheet
        visible={pickerKind === 'weekday'}
        onClose={onClose}
        title={tr('planned.weekdayLabel')}
        options={range(1, 7).map((d) => ({ key: d, label: weekdayName(Number(d)) }))}
        selected={String(
          repetitions[pickerIndex]?.type === 'ndom'
            ? parseNdom(repetitions[pickerIndex]?.moment ?? '').weekday
            : Number(repetitions[pickerIndex]?.moment) || 1,
        )}
        onSelect={(key) => {
          if (key) {
            const rep = repetitions[pickerIndex];
            if (rep?.type === 'ndom') {
              const currentNth = parseNdom(rep.moment).nth;
              patchRow(pickerIndex, { moment: ndomMoment(currentNth, Number(key)) });
            } else {
              patchRow(pickerIndex, { moment: key });
            }
          }
          onClose();
        }}
      />
      <PickerSheet
        visible={pickerKind === 'repType'}
        onClose={onClose}
        title={tr('planned.repTypeLabel')}
        options={REPETITION_TYPES.map((type) => ({ key: type, label: repetitionTypeName(type) }))}
        selected={repetitions[pickerIndex]?.type ?? 'monthly'}
        onSelect={(key) => {
          if (key) {
            const type = REPETITION_TYPES.find((x) => x === key);
            if (type) patchRow(pickerIndex, { type, moment: momentFor(type, date) });
          }
          onClose();
        }}
      />
    </>
  );
}
