// One chooser for every "choose one of these" sheet — currency, category, budget, account, role,
// language — on SearchListSheet, so it shares the Choose look: a grouped card of rows, a checkmark
// on the chosen one, search above 8 options, and "Suggested" first. Picking a row reports it and
// closes the sheet. The "none" choice is a row of its own above the list, so it never sorts or
// filters away.
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { ChooseRow, SearchListSheet } from './SearchListSheet';
import { Dot } from './components';
import { useTheme } from './theme';

interface PickerOption {
  key: string;
  label: string;
  dotColor?: string;
}

/** Case- and diacritic-insensitive, so "zabka" finds "Żabka". */
function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
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
  suggested,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  options: PickerOption[];
  selected: string | null | undefined;
  /** Called with null when the "none" row is picked. */
  onSelect: (key: string | null) => void;
  /** Adds a first row that clears the choice. */
  noneLabel?: string;
  /** Shown above the list (a hint). */
  header?: ReactNode;
  /** Shown instead of the list when there are no options. */
  empty?: ReactNode;
  /** Option keys to list first under "Suggested". */
  suggested?: string[];
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();

  function pick(key: string | null) {
    onSelect(key);
    onClose();
  }

  const suggestedOptions = suggested
    ?.map((key) => options.find((o) => o.key === key))
    .filter((o): o is PickerOption => !!o);

  return (
    <SearchListSheet
      visible={visible}
      onClose={onClose}
      title={title}
      placeholder={tr('pickers.search')}
      items={(query) => {
        const q = fold(query.trim());
        return q ? options.filter((o) => fold(o.label).includes(q)) : options;
      }}
      keyOf={(o) => o.key}
      labelOf={(o) => o.label}
      suggested={suggestedOptions}
      selectedKey={selected}
      empty={empty}
      header={
        <>
          {header}
          {!!noneLabel && (
            <ChooseRow first last selected={!selected} onPress={() => pick(null)}>
              <Text style={[t.type.body, { color: t.color.text }]}>{noneLabel}</Text>
            </ChooseRow>
          )}
        </>
      }
      renderRow={(o) => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
          {!!o.dotColor && <Dot color={o.dotColor} />}
          <Text style={[t.type.body, { color: t.color.text, flex: 1 }]} numberOfLines={1}>
            {o.label}
          </Text>
        </View>
      )}
      onSelect={(o) => onSelect(o.key)}
    />
  );
}
