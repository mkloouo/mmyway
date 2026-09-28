// The one search box: every list search (Activity, Settings › Accounts and Aliases, the account,
// payee and target pickers) draws this, so they look and behave alike — a filled surface with a
// magnifier and a clear button, rather than a thin outline that read as disabled on the page
// background.
import { Pressable, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from './theme';

export function SearchField({
  value,
  onChangeText,
  placeholder,
  autoFocus,
  onClear,
  style,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  /** Replaces the default clear (empty the text), e.g. to also reset filters. */
  onClear?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const showClear = value.length > 0 || !!onClear;
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.space.sm,
          backgroundColor: t.color.surface,
          borderWidth: 1,
          borderColor: t.color.border,
          borderRadius: t.radius.md,
          paddingLeft: t.space.md,
        },
        style,
      ]}
    >
      <Ionicons name="search" size={18} color={t.color.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.color.textMuted}
        autoFocus={autoFocus}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        style={[t.type.body, { flex: 1, color: t.color.text, paddingVertical: t.space.md }]}
      />
      {showClear ? (
        <Pressable
          onPress={onClear ?? (() => onChangeText(''))}
          accessibilityRole="button"
          accessibilityLabel={tr('pickers.clearSearch')}
          hitSlop={8}
          style={({ pressed }) => ({
            paddingHorizontal: t.space.md,
            paddingVertical: t.space.sm,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Ionicons name="close-circle" size={18} color={t.color.textMuted} />
        </Pressable>
      ) : (
        <View style={{ width: t.space.md }} />
      )}
    </View>
  );
}
