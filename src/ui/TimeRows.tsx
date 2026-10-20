import { useTranslation } from 'react-i18next';
import { ListRow } from './kit';
import { pickTime } from './pickDate';

export function TimeRows({
  time,
  onChange,
  first,
}: {
  time: string | null;
  onChange: (time: string | null) => void;
  first?: boolean;
}) {
  const { t: tr } = useTranslation();
  return (
    <>
      <ListRow
        first={first}
        label={tr('planned.time')}
        value={time ?? tr('planned.anyTime')}
        chevron
        onPress={() => pickTime(time, (t) => onChange(t))}
      />
      {!!time && (
        <ListRow
          label={tr('planned.clearTime')}
          icon="close-circle"
          onPress={() => onChange(null)}
        />
      )}
    </>
  );
}
