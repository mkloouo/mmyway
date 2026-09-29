// One search-and-pick sheet, on top of the shared Sheet (design §4): a search field, a FlatList of
// bordered rows, "No matches", and an optional footer for "use this new name". The account, target
// and payee pickers are thin wrappers around it. The query is cleared on every close and select
// path, which each of them used to remember to do.
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, Text } from 'react-native';
import { PRESSED_OPACITY, pressedStyle, Sheet } from './components';
import { SearchField } from './SearchField';
import { useTheme } from './theme';

export function SearchListSheet<T>({
  visible,
  onClose,
  title,
  placeholder,
  items,
  keyOf,
  renderRow,
  onSelect,
  footer,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  placeholder: string;
  /** Already filtered and ranked by the caller, which owns what "matching" means for its rows. */
  items: (query: string) => T[];
  keyOf: (item: T) => string;
  renderRow: (item: T) => ReactNode;
  onSelect: (item: T) => void;
  /** "Use <name> (will be created)", given the trimmed query and a close that clears it. */
  footer?: (query: string, close: () => void) => ReactNode;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const [query, setQuery] = useState('');

  function close() {
    setQuery('');
    onClose();
  }

  const trimmed = query.trim();
  // Only while open: a closed sheet still renders with its screen, and ranking ~400 payees on
  // every render made each keypad digit on Capture lag behind the finger.
  const results = visible ? items(query) : [];

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title={title}
      scroll={false}
      footer={footer?.(trimmed, close)}
    >
      <SearchField
        value={query}
        onChangeText={setQuery}
        placeholder={placeholder}
        autoFocus
        style={{ marginBottom: t.space.sm }}
      />
      <FlatList
        data={results}
        keyExtractor={keyOf}
        style={{ flex: 1 }}
        // Keeps the right-aligned column clear of Android's scrollbar, which draws over the content.
        contentContainerStyle={{ paddingRight: t.space.md }}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => {
              onSelect(item);
              close();
            }}
            style={({ pressed }) => ({
              paddingVertical: t.space.sm,
              borderTopWidth: 1,
              borderTopColor: t.color.border,
              opacity: pressed ? PRESSED_OPACITY : 1,
            })}
          >
            {renderRow(item)}
          </Pressable>
        )}
        ListEmptyComponent={
          <Text
            style={[
              t.type.body,
              { color: t.color.textFaint, paddingVertical: t.space.lg, textAlign: 'center' },
            ]}
          >
            {tr('pickers.noMatches')}
          </Text>
        }
      />
    </Sheet>
  );
}

/** The sheets' shared footer action: "Use <name> (will be created)". */
export function UseNewFooter({ label, onPress }: { label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => pressedStyle(pressed, { paddingVertical: t.space.md })}
    >
      <Text style={[t.type.body, { color: t.color.accent, fontWeight: '600' }]}>{label}</Text>
    </Pressable>
  );
}
