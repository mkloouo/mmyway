// The Choose sheet (design "A · Choose"): one search-and-pick sheet on the shared Sheet. Options are
// rows in one white grouped card, the chosen one shows a checkmark, and the search field appears
// above 8 options (focused above 30). With an empty query it lists "Suggested" first, then every
// option A–Z, split by first letter with an index rail above 30; with a query it shows the caller's
// filtered results flat. The account, target and payee pickers are thin wrappers around it. The
// query is cleared whenever the sheet closes, whichever path closed it.
import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, Pressable, SectionList, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button, PRESSED_OPACITY, Sheet } from './kit';
import { SearchField } from './SearchField';
import { useTheme } from './theme';

const SEARCH_THRESHOLD = 8;
const SPLIT_BY_LETTER_THRESHOLD = 5;

interface Row<T> {
  key: string;
  item: T;
}

interface Section<T> {
  key: string;
  title?: string;
  letter?: string;
  count?: number;
  data: Row<T>[];
}

export function SearchListSheet<T>({
  visible,
  onClose,
  title,
  subtitle,
  placeholder,
  items,
  keyOf,
  labelOf,
  chosen,
  suggested,
  selectedKey,
  header,
  empty,
  renderRow,
  onSelect,
  footer,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  placeholder: string;
  /** Already filtered and ranked by the caller, which owns what "matching" means for its rows. */
  items: (query: string) => T[];
  keyOf: (item: T) => string;
  /** Enables A–Z order (and letter sections above 30 rows) while the query is empty. */
  labelOf?: (item: T) => string;
  /** Currently chosen item, shown first under "Chosen" while browsing. */
  chosen?: T;
  /** Shown under "Suggested" while the query is empty. */
  suggested?: T[];
  /** The row to mark with a checkmark. */
  selectedKey?: string | null;
  /** Shown above the list, outside the scroll, e.g. a choice that is always on top. */
  header?: ReactNode;
  /** Shown instead of "No matches" when there is nothing to browse at all. */
  empty?: ReactNode;
  renderRow: (item: T) => ReactNode;
  onSelect: (item: T) => void;
  /** "Use <name> (will be created)", given the trimmed query and a close that clears it. */
  footer?: (query: string, close: () => void) => ReactNode;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const [query, setQuery] = useState('');
  const listRef = useRef<SectionList<Row<T>, Section<T>>>(null);

  function close() {
    setQuery('');
    onClose();
  }

  // A parent can close the sheet itself (a "None" row in the header does), so clear here too.
  const [wasVisible, setWasVisible] = useState(visible);
  if (wasVisible !== visible) {
    setWasVisible(visible);
    if (!visible) setQuery('');
  }

  const trimmed = query.trim();
  const browsing = visible && !trimmed;
  // Only while open: a closed sheet still renders with its screen, and ranking ~400 payees on
  // every render made each keypad digit on Capture lag behind the finger.
  const results = visible ? items(trimmed ? query : '') : [];
  const showSearch = !!trimmed || results.length > SEARCH_THRESHOLD;

  const sections: Section<T>[] = [];
  if (browsing) {
    const excludeKey = chosen != null ? keyOf(chosen) : null;
    if (chosen != null) {
      sections.push({
        key: 'chosen',
        title: tr('pickers.chosen'),
        data: rowsOf([chosen], keyOf, 'chosen'),
      });
    }
    const browseSuggested = excludeKey
      ? suggested?.filter((item) => keyOf(item) !== excludeKey)
      : suggested;
    if (browseSuggested?.length) {
      sections.push({
        key: 'suggested',
        title: tr('pickers.suggested'),
        data: rowsOf(browseSuggested, keyOf, 'suggested'),
      });
    }
    const browseResults = excludeKey
      ? results.filter((item) => keyOf(item) !== excludeKey)
      : results;
    if (labelOf) {
      const sorted = [...browseResults].sort((a, b) =>
        labelOf(a).localeCompare(labelOf(b), undefined, { sensitivity: 'base' }),
      );
      if (sorted.length > SPLIT_BY_LETTER_THRESHOLD) {
        const byLetter = new Map<string, T[]>();
        for (const item of sorted) {
          const letter = letterOf(labelOf(item));
          const group = byLetter.get(letter);
          if (group) group.push(item);
          else byLetter.set(letter, [item]);
        }
        for (const [letter, group] of byLetter) {
          sections.push({
            key: `letter:${letter}`,
            title: letter,
            letter,
            count: group.length,
            data: rowsOf(group, keyOf, `letter:${letter}`),
          });
        }
      } else if (sorted.length) {
        sections.push({
          key: 'all',
          title: tr('pickers.allAZ'),
          data: rowsOf(sorted, keyOf, 'all'),
        });
      }
    } else if (browseResults.length) {
      sections.push({ key: 'all', data: rowsOf(browseResults, keyOf, 'all') });
    }
  } else if (results.length) {
    sections.push({ key: 'results', data: rowsOf(results, keyOf, 'results') });
  }

  const letterSections = sections.flatMap((s, index) =>
    s.letter ? [{ letter: s.letter, index }] : [],
  );

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title={title}
      subtitle={subtitle}
      scroll={false}
      footer={footer?.(trimmed, close)}
    >
      {showSearch && (
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder={placeholder}
          autoFocus={results.length > 30}
          style={{ marginBottom: t.space.sm }}
        />
      )}
      {header}
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <SectionList
          ref={listRef}
          sections={sections}
          keyExtractor={(row) => row.key}
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="always"
          stickySectionHeadersEnabled={false}
          // Keeps the right-aligned column clear of Android's scrollbar, which draws over the content.
          contentContainerStyle={{ paddingRight: t.space.md, paddingBottom: t.space.sm }}
          renderSectionHeader={({ section }) =>
            section.title ? (
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingHorizontal: 4,
                  paddingTop: t.space.lg,
                  paddingBottom: t.space.sm,
                }}
              >
                <Text
                  style={[
                    t.type.caption,
                    {
                      color: t.color.textMuted,
                      textTransform: 'uppercase',
                      fontWeight: '600',
                    },
                  ]}
                >
                  {section.title}
                </Text>
                {section.count != null && (
                  <Text
                    style={[
                      t.type.caption,
                      {
                        color: t.color.textMuted,
                        letterSpacing: 0,
                      },
                    ]}
                  >
                    {section.count}
                  </Text>
                )}
              </View>
            ) : null
          }
          renderItem={({ item: row, index, section }) => (
            <ChooseRow
              first={index === 0}
              last={index === section.data.length - 1}
              selected={selectedKey != null && keyOf(row.item) === selectedKey}
              onPress={() => {
                onSelect(row.item);
                close();
              }}
            >
              {renderRow(row.item)}
            </ChooseRow>
          )}
          ListEmptyComponent={
            <View style={{ paddingVertical: t.space.lg }}>
              {browsing && empty ? (
                empty
              ) : (
                <Text style={[t.type.body, { color: t.color.textFaint, textAlign: 'center' }]}>
                  {tr('pickers.noMatches')}
                </Text>
              )}
            </View>
          }
        />
        {browsing && letterSections.length > 0 && (
          <View style={{ justifyContent: 'center', paddingRight: t.space.xs, gap: 2 }}>
            {letterSections.map(({ letter, index }) => (
              <Pressable
                key={letter}
                testID={`letter-index-${letter}`}
                accessibilityRole="button"
                accessibilityLabel={tr('pickers.letterIndex', { letter })}
                hitSlop={6}
                onPress={() =>
                  listRef.current?.scrollToLocation({
                    sectionIndex: index,
                    itemIndex: 0,
                    animated: false,
                  })
                }
              >
                <Text
                  style={[
                    t.type.caption,
                    {
                      color: t.color.accent,
                      letterSpacing: 0,
                      fontSize: 10,
                      lineHeight: 12,
                      width: 14,
                      textAlign: 'center',
                    },
                  ]}
                >
                  {letter}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </Sheet>
  );
}

/** One row of the grouped card. The first and last rows round the card's corners; each row draws
 *  its own top hairline and side edges, so the card reads as one Group inside any section. */
export function ChooseRow({
  first,
  last,
  selected,
  onPress,
  children,
}: {
  first: boolean;
  last: boolean;
  selected: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={() => {
        Keyboard.dismiss();
        onPress();
      }}
      unstable_pressDelay={0}
      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
      pressRetentionOffset={{ top: 60, bottom: 60, left: 30, right: 30 }}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space.md,
        minHeight: 52,
        paddingHorizontal: t.space.lg,
        backgroundColor: t.color.surface,
        borderColor: t.color.border,
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderTopWidth: first ? 1 : 0,
        borderBottomWidth: last ? 1 : 0,
        borderTopLeftRadius: first ? t.radius.md : 0,
        borderTopRightRadius: first ? t.radius.md : 0,
        borderBottomLeftRadius: last ? t.radius.md : 0,
        borderBottomRightRadius: last ? t.radius.md : 0,
        position: 'relative',
        opacity: pressed ? PRESSED_OPACITY : 1,
      })}
    >
      {!first && (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 16,
            right: 0,
            height: 1,
            backgroundColor: t.color.border,
          }}
        />
      )}
      <View style={{ flex: 1, paddingVertical: t.space.sm }}>{children}</View>
      {selected && <Ionicons name="checkmark" size={18} color={t.color.accent} />}
    </Pressable>
  );
}

function rowsOf<T>(items: T[], keyOf: (item: T) => string, sectionKey: string): Row<T>[] {
  return items.map((item) => ({ key: `${sectionKey}:${keyOf(item)}`, item }));
}

/** The index-rail letter for a label: its first letter, or "#" for digits and symbols. */
function letterOf(label: string): string {
  const first = label.trim().charAt(0).toLocaleUpperCase();
  return /\p{L}/u.test(first) ? first : '#';
}

/** The sheets' shared footer action: "Use <name> (will be created)". */
export function UseNewFooter({ label, onPress }: { label: string; onPress: () => void }) {
  return <Button title={label} onPress={onPress} variant="secondary" style={{ width: '100%' }} />;
}
