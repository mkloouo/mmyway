// The one text input style (design §4): every form field in the app draws from here instead of
// restating border, radius, padding and placeholder colour inline. SearchField is the search
// variant with its icon and clear button.
import { useEffect, useRef, useState } from 'react';
import { TextInput, type TextInputProps } from 'react-native';
import { useTheme } from './theme';

export interface TextFieldProps extends TextInputProps {
  invalid?: boolean;
  /**
   * For a `value` that round-trips through storage (a draft saved to SQLite and read back by a
   * live query) instead of plain component state. Each keystroke's write comes back a moment
   * later, and a controlled input re-set to that older text moves the cursor and drops or
   * repeats what was typed in between. Buffered, the field keeps its own text while focused and
   * only takes `value` from outside when the user isn't typing in it.
   */
  buffered?: boolean;
}

export function TextField({ style, invalid, buffered, value, onChangeText, onFocus, onBlur, ...props }: TextFieldProps) {
  const t = useTheme();
  const [text, setText] = useState(value ?? '');
  const focused = useRef(false);
  useEffect(() => {
    if (buffered && !focused.current) setText(value ?? '');
  }, [buffered, value]);

  return (
    <TextInput
      placeholderTextColor={t.color.textFaint}
      {...props}
      value={buffered ? text : value}
      onChangeText={(next) => {
        if (buffered) setText(next);
        onChangeText?.(next);
      }}
      onFocus={(e) => {
        focused.current = true;
        onFocus?.(e);
      }}
      onBlur={(e) => {
        focused.current = false;
        onBlur?.(e);
      }}
      style={[
        {
          borderWidth: 1, borderColor: invalid ? t.color.danger : t.color.border, borderRadius: t.radius.sm,
          paddingHorizontal: t.space.md, paddingVertical: t.space.sm, color: t.color.text,
        },
        style,
      ]}
    />
  );
}
