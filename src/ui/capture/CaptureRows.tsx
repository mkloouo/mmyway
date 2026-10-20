import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '../theme';
import { Chip, Dot, IconButton, PRESSED_OPACITY } from '../kit';
import { topChips } from '../../capture/topChips';
import type { AccountPickerAccount } from '../../accounts/useAssetAccounts';

/** A pill under the amount: the currency, the date, Details. `dot` marks a Details that holds something. */
export function Pill({
  label,
  accessibilityLabel,
  onPress,
  dot,
  caret,
}: {
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  dot?: boolean;
  caret?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space.xs,
        paddingHorizontal: t.space.sm,
        paddingVertical: t.space.xs,
        borderRadius: t.radius.pill,
        backgroundColor: t.color.surfaceAlt,
        opacity: pressed ? PRESSED_OPACITY : 1,
      })}
    >
      <Text style={[t.type.label, { color: t.color.text, fontWeight: '600' }]}>{label}</Text>
      {caret && <Ionicons name="caret-down" size={10} color={t.color.textMuted} />}
      {!!dot && <Dot color={t.color.accent} size={6} />}
    </Pressable>
  );
}

/** The 3 px warn bar on the left edge of a row that is blocking confirm. */
export function WarnBar() {
  const t = useTheme();
  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: 3,
        backgroundColor: t.color.warn,
      }}
    />
  );
}

/**
 * One picker field of Capture's card: a grey key label, ONE horizontal row of suggestion chips and
 * a trailing 🔍 button that opens the full Choose sheet. A field that blocks confirming gets a warn
 * bar on its left edge and a warn label.
 */
export function FieldRow({
  label,
  blocking,
  searchLabel,
  onSearch,
  children,
}: {
  label: string;
  blocking?: boolean;
  searchLabel: string;
  onSearch: () => void;
  children: ReactNode;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 48,
        paddingLeft: t.space.lg,
        borderTopWidth: 1,
        borderTopColor: t.color.border,
      }}
    >
      {!!blocking && <WarnBar />}
      <Text
        numberOfLines={1}
        style={[
          t.type.label,
          {
            width: 58,
            color: blocking ? t.color.warn : t.color.textFaint,
          },
        ]}
      >
        {label}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flex: 1 }}
        contentContainerStyle={{
          alignItems: 'center',
          gap: t.space.sm,
          paddingLeft: t.space.sm,
          paddingRight: t.space.md,
        }}
      >
        <IconButton
          icon="search"
          variant="tinted"
          size={16}
          label={searchLabel}
          onPress={onSearch}
        />
        {children}
      </ScrollView>
    </View>
  );
}

/** A field row of account chips. Capture draws this for from, to, and the single account of a non-transfer. */
export function AccountFieldRow({
  label,
  searchLabel,
  accounts,
  selectedId,
  blocking,
  onSearch,
  onSelect,
}: {
  label: string;
  searchLabel: string;
  accounts: AccountPickerAccount[];
  selectedId: string | null | undefined;
  blocking?: boolean;
  onSearch: () => void;
  onSelect: (id: string) => void;
}) {
  return (
    <FieldRow label={label} searchLabel={searchLabel} onSearch={onSearch} blocking={blocking}>
      {topChips(accounts, selectedId).map((a) => (
        <Chip
          key={a.id}
          label={a.name}
          selected={selectedId === a.id}
          onPress={() => onSelect(a.id)}
        />
      ))}
    </FieldRow>
  );
}
