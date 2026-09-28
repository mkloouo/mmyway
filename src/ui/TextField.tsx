// The one text input style (design §4): every form field in the app draws from here instead of
// restating border, radius, padding and placeholder colour inline. SearchField is the search
// variant with its icon and clear button.
import { TextInput, type TextInputProps } from 'react-native';
import { useTheme } from './theme';

export function TextField({ style, invalid, ...props }: TextInputProps & { invalid?: boolean }) {
  const t = useTheme();
  return (
    <TextInput
      placeholderTextColor={t.color.textFaint}
      {...props}
      style={[
        {
          borderWidth: 1,
          borderColor: invalid ? t.color.danger : t.color.border,
          borderRadius: t.radius.sm,
          paddingHorizontal: t.space.md,
          paddingVertical: t.space.sm,
          color: t.color.text,
        },
        style,
      ]}
    />
  );
}
