// The one text input style (design §4): every form field in the app draws from here instead of
// restating border, radius, padding and placeholder colour inline. SearchField is the search
// variant with its icon and clear button.
import { useEffect, useRef, useState } from 'react';
import { TextInput, type TextInputProps } from 'react-native';
import { useTheme } from './theme';

interface TextFieldProps extends TextInputProps {
  invalid?: boolean;
  /**
   * For a `value` that is stored rather than held in component state (a draft saved to SQLite and
   * read back by a live query). Writing every keystroke put a database round trip, a 100 ms
   * live-query wait and a re-render of the screen behind each letter, and the value coming back
   * late moved the cursor and dropped or repeated what was typed in between.
   *
   * With `onCommit` the field edits its own text and calls it once, with the final text: when the
   * field loses focus, or when it unmounts (a sheet closing on Done, the scrim or Android back).
   * Nothing is written if the text didn't change. `value` is taken from outside only while the
   * field isn't focused. `onChangeText` still fires per keystroke, for a caller that wants it.
   */
  onCommit?: (text: string) => void;
}

export function TextField({
  style,
  invalid,
  value,
  onChangeText,
  onCommit,
  onFocus,
  onBlur,
  ...props
}: TextFieldProps) {
  const t = useTheme();
  const [text, setText] = useState(value ?? '');
  const focused = useRef(false);
  // The text as the outside knows it: what came in through `value`, or was last committed.
  const known = useRef(value ?? '');
  const typed = useRef(value ?? '');
  const commitRef = useRef<() => void>(() => {});

  // Refreshed after every render so the unmount cleanup below commits with the caller's latest
  // callback rather than the one from the first render.
  useEffect(() => {
    commitRef.current = () => {
      if (!onCommit || typed.current === known.current) return;
      known.current = typed.current;
      onCommit(typed.current);
    };
  });
  useEffect(() => () => commitRef.current(), []);

  useEffect(() => {
    if (!onCommit || focused.current) return;
    const next = value ?? '';
    known.current = next;
    typed.current = next;
    setText(next);
  }, [onCommit, value]);

  return (
    <TextInput
      placeholderTextColor={t.color.textFaint}
      {...props}
      value={onCommit ? text : value}
      onChangeText={(next) => {
        typed.current = next;
        if (onCommit) setText(next);
        onChangeText?.(next);
      }}
      onFocus={(e) => {
        focused.current = true;
        onFocus?.(e);
      }}
      onBlur={(e) => {
        focused.current = false;
        commitRef.current();
        onBlur?.(e);
      }}
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
