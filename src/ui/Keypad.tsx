// The keypad of the amount sheets (design §6.2): digits plus a backspace and a confirm cell share
// one 4x4 grid so the bottom cluster reads as one control. Capture's keypad is the digits, decimal
// and backspace only (three across); Capture draws its own save buttons under it.
import { useState } from 'react';
import { Animated, Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from './theme';
import { PRESSED_OPACITY } from './kit';
import { haptics } from './haptics';
import type { KeypadKey } from '../capture/amountInput';

const DIGIT_ROWS: KeypadKey[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  [',', '0', '00'],
];

const FULL_ROWS: KeypadKey[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  [',', '0'],
];

function Key({
  label,
  onPress,
  tone,
  disabled,
  testID,
  height,
}: {
  label: string;
  onPress: () => void;
  tone?: 'default' | 'accent';
  disabled?: boolean;
  /** For the Maestro flows (.maestro/): a digit's label also matches the amount it typed. */
  testID?: string;
  /** A fixed height instead of the width-based 1.4 ratio (Capture sizes its keys to the window). */
  height?: number;
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
      style={{ flex: 1, marginHorizontal: 3, marginVertical: 3, transform: [{ scale }] }}
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
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => ({
          ...(height ? { height } : { aspectRatio: 1.4 }),
          borderRadius: 12,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: isAccent ? t.color.accent : t.color.surface,
          opacity: disabled ? 0.4 : pressed ? PRESSED_OPACITY : 1,
        })}
      >
        <Text
          style={{
            fontSize: 22,
            fontWeight: '500',
            color: isAccent ? t.color.onAccent : t.color.text,
            textAlign: 'center',
          }}
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
  /** Every key's height; without it a key is 1/1.4 of its width. */
  keyHeight?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * `compact` is digits, backspace and a single confirm cell (a sheet's amount edit). Without it the
 * keypad is digits, decimal and backspace only: the confirm lives in the screen's own buttons.
 */
type KeypadProps = KeypadBaseProps &
  (
    | {
        compact: true;
        saveLabel: string;
        onSave: () => void;
        saveDisabled?: boolean;
        saving?: boolean;
      }
    | { compact?: false }
  );

/** The empty cell that stands in for the second and third rows' extra key in `compact` mode. */
function Spacer() {
  return <View style={{ flex: 1, marginHorizontal: 3, marginVertical: 3 }} />;
}

export function Keypad(props: KeypadProps) {
  const { onDigit, keyHeight, style } = props;
  const digit = (label: KeypadKey) => (
    <Key
      key={label}
      label={label}
      onPress={() => onDigit(label)}
      testID={`keypad-${label === ',' ? 'decimal' : label}`}
      height={keyHeight}
    />
  );
  const backspace = (
    <Key label="⌫" onPress={() => onDigit('⌫')} testID="keypad-backspace" height={keyHeight} />
  );

  if (!props.compact) {
    return (
      <View style={style}>
        {FULL_ROWS.map((row, rowIndex) => (
          <View key={rowIndex} style={{ flexDirection: 'row' }}>
            {row.map(digit)}
            {rowIndex === 3 && backspace}
          </View>
        ))}
      </View>
    );
  }

  const { saveLabel, onSave, saveDisabled, saving } = props;
  return (
    <View style={style}>
      {DIGIT_ROWS.map((row, rowIndex) => (
        <View key={rowIndex} style={{ flexDirection: 'row' }}>
          {row.map(digit)}
          {rowIndex === 0 && backspace}
          {(rowIndex === 1 || rowIndex === 2) && <Spacer />}
          {rowIndex === 3 && (
            <Key
              label={saveLabel}
              tone="accent"
              testID="keypad-save"
              onPress={onSave}
              disabled={saveDisabled || saving}
              height={keyHeight}
            />
          )}
        </View>
      ))}
    </View>
  );
}
