// The 4x4 grid of design §6.2: digits plus the date, note and save cells share its layout so
// the whole bottom cluster reads as one control.
import { useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from './theme';
import { PRESSED_OPACITY } from './components';
import { haptics } from './haptics';
import type { KeypadKey } from '../capture/amountInput';

const DIGIT_ROWS: KeypadKey[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  [',', '0', '00'],
];

function Key({
  label,
  onPress,
  tone,
  disabled,
}: {
  label: string;
  onPress: () => void;
  tone?: 'default' | 'accent';
  disabled?: boolean;
}) {
  const t = useTheme();
  const isAccent = tone === 'accent';
  // The key shrinks under the finger with the buzz: the same moment felt and seen, so a phone
  // without a vibration motor still shows that the press landed.
  const [scale] = useState(() => new Animated.Value(1));
  const press = (to: number) =>
    Animated.spring(scale, {
      toValue: to,
      speed: 40,
      bounciness: 6,
      useNativeDriver: true,
    }).start();
  return (
    <Animated.View
      style={{ flex: 1, marginHorizontal: 4, marginVertical: 4, transform: [{ scale }] }}
    >
      <Pressable
        // On press-in, not release: the buzz lands with the finger, the way a keyboard's does.
        onPressIn={() => {
          void haptics.key();
          press(0.9);
        }}
        onPressOut={() => press(1)}
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => ({
          aspectRatio: 1.4,
          borderRadius: t.radius.sm,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: isAccent ? t.color.accent : t.color.surfaceAlt,
          opacity: disabled ? 0.4 : pressed ? PRESSED_OPACITY : 1,
        })}
      >
        <Text
          style={[
            t.type.heading,
            { color: isAccent ? t.color.onAccent : t.color.text, textAlign: 'center' },
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

interface KeypadBaseProps {
  onDigit: (key: KeypadKey) => void;
  saveLabel: string;
  onSave: () => void;
  saveDisabled?: boolean;
  saving?: boolean;
}

/**
 * `compact` is digits, backspace and a single confirm cell (a sheet's amount edit); the full
 * keypad also has the date and note cells, and needs all three of their props — a union rather
 * than optional props, so a caller that forgets one doesn't compile.
 */
export type KeypadProps = KeypadBaseProps &
  (
    | { compact: true }
    | {
        compact?: false;
        dateLabel: string;
        onDatePress: () => void;
        onNotePress: () => void;
        noteHasValue?: boolean;
      }
  );

/** The empty cell that stands in for the date and note keys in `compact` mode. */
function Spacer() {
  return <View style={{ flex: 1, marginHorizontal: 4, marginVertical: 4 }} />;
}

export function Keypad(props: KeypadProps) {
  const { onDigit, saveLabel, onSave, saveDisabled, saving } = props;
  const { t: tr } = useTranslation();
  return (
    <View>
      {DIGIT_ROWS.map((row, rowIndex) => (
        <View key={rowIndex} style={{ flexDirection: 'row' }}>
          {row.map((key) => (
            <Key key={key} label={key} onPress={() => onDigit(key)} />
          ))}
          {rowIndex === 0 && <Key label="⌫" onPress={() => onDigit('⌫')} />}
          {rowIndex === 1 &&
            (props.compact ? (
              <Spacer />
            ) : (
              <Key label={props.dateLabel} onPress={props.onDatePress} />
            ))}
          {rowIndex === 2 &&
            (props.compact ? (
              <Spacer />
            ) : (
              <Key
                label={props.noteHasValue ? `${tr('fields.note')} ●` : tr('fields.note')}
                onPress={props.onNotePress}
              />
            ))}
          {rowIndex === 3 && (
            <Key
              label={saveLabel}
              tone="accent"
              onPress={onSave}
              disabled={saveDisabled || saving}
            />
          )}
        </View>
      ))}
    </View>
  );
}
