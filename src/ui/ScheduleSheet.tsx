import { useTranslation } from 'react-i18next';
import { Button, Sheet } from './kit';
import { ScheduleSummary } from './ScheduleSummary';
import { ScheduleRows } from './ScheduleRows';
import type { PlannedGroup } from '../planned/model';
import type { EndCondition, Repetition } from '../planned/repetition';

export interface ScheduleSheetProps {
  visible: boolean;
  onClose: () => void;
  /** FF3's own description of the schedule, when it holds one. */
  group?: PlannedGroup | null;
  repeats: boolean;
  repetitions: Repetition[];
  end: EndCondition;
  /** The first date (YYYY-MM-DD). */
  date: string;
  time?: string | null;
  onChange: (patch: {
    date?: string;
    time?: string | null;
    repeats?: boolean;
    repetitions?: Repetition[];
    end?: EndCondition;
  }) => void;
}

/**
 * Modal sheet for editing a planned transaction's schedule (V4 board 22):
 * Summary callout, Starts (first date + time), Repeats (frequency, interval, patterns, weekend),
 * and Ends (forever, until date, times).
 */
export function ScheduleSheet({
  visible,
  onClose,
  group,
  repeats,
  repetitions,
  end,
  date,
  time,
  onChange,
}: ScheduleSheetProps) {
  const { t: tr } = useTranslation();

  return (
    <Sheet
      visible={visible}
      title={tr('planned.schedule')}
      onClose={onClose}
      footer={<Button title={tr('common.done')} onPress={onClose} size="lg" />}
    >
      <ScheduleSummary
        repeats={repeats}
        repetitions={repetitions}
        end={end}
        date={date}
        group={group}
      />
      <ScheduleRows
        repeats={repeats}
        repetitions={repetitions}
        end={end}
        date={date}
        time={time}
        onChange={onChange}
      />
    </Sheet>
  );
}
