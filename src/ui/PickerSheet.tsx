// One chip picker for every "choose one of these" sheet — currency, category, budget, account,
// role, language — instead of the same Sheet + wrapped Chips rebuilt on each screen. Picking a
// chip reports it and closes the sheet.
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Chip, Sheet } from './components';
import { useTheme } from './theme';

export interface PickerOption {
  key: string;
  label: string;
  dotColor?: string;
}

export function PickerSheet({
  visible,
  onClose,
  title,
  options,
  selected,
  onSelect,
  noneLabel,
  header,
  empty,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  options: PickerOption[];
  selected: string | null | undefined;
  /** Called with null when the "none" chip is picked. */
  onSelect: (key: string | null) => void;
  /** Adds a first chip that clears the choice. */
  noneLabel?: string;
  /** Shown above the chips (a hint). */
  header?: ReactNode;
  /** Shown instead of the chips when there are no options. */
  empty?: ReactNode;
}) {
  const t = useTheme();
  function pick(key: string | null) {
    onSelect(key);
    onClose();
  }
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      {header}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
        {!!noneLabel && <Chip label={noneLabel} selected={!selected} onPress={() => pick(null)} />}
        {options.map((o) => (
          <Chip
            key={o.key}
            label={o.label}
            dotColor={o.dotColor}
            selected={o.key === selected}
            onPress={() => pick(o.key)}
          />
        ))}
        {options.length === 0 && empty}
      </View>
    </Sheet>
  );
}
