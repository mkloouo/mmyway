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
  testID,
  small,
  height,
}: {
  label: string;
  onPress: () => void;
  tone?: 'default' | 'accent';
  disabled?: boolean;
  /** A long label (a picked date and time): drawn much smaller so it fits the key instead of being cut. */
  small?: boolean;
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
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => ({
          ...(height ? { height } : { aspectRatio: 1.4 }),
          borderRadius: t.radius.sm,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: isAccent ? t.color.accent : t.color.surfaceAlt,
          opacity: disabled ? 0.4 : pressed ? PRESSED_OPACITY : 1,
        })}
      >
        <Text
          style={[
            small ? t.type.label : t.type.heading,
            { color: isAccent ? t.color.onAccent : t.color.text, textAlign: 'center' },
            small && { fontSize: 12, lineHeight: 15 },
          ]}
          numberOfLines={1}
          adjustsFontSizeToFit={small}
          minimumFontScale={0.75}
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
  /** Every key's height; without it a key is 1/1.4 of its width. */
  keyHeight?: number;
}

/**
 * `compact` is digits, backspace and a single confirm cell (a sheet's amount edit); the full
 * keypad also has the date and note cells, and needs all three of their props — a union rather
 * than optional props, so a caller that forgets one doesn't compile.
 */
type KeypadProps = KeypadBaseProps &
  (
    | { compact: true }
    | {
        compact?: false;
        dateLabel: string;
        /** The date is a picked one, so its label is long: drawn small. */
        dateCompact?: boolean;
        onDatePress: () => void;
        /** Opens the rest of the entry's fields (description, who it is shared with, a photo). */
        onMorePress: () => void;
        moreHasValue?: boolean;
      }
  );

/** The empty cell that stands in for the date and note keys in `compact` mode. */
function Spacer() {
  return <View style={{ flex: 1, marginHorizontal: 4, marginVertical: 4 }} />;
}

export function Keypad(props: KeypadProps) {
  const { onDigit, saveLabel, onSave, saveDisabled, saving, keyHeight } = props;
  const { t: tr } = useTranslation();
  return (
    <View>
      {DIGIT_ROWS.map((row, rowIndex) => (
        <View key={rowIndex} style={{ flexDirection: 'row' }}>
          {row.map((key) => (
            <Key
              key={key}
              label={key}
              onPress={() => onDigit(key)}
              testID={`keypad-${key === ',' ? 'decimal' : key}`}
              height={keyHeight}
            />
          ))}
          {rowIndex === 0 && (
            <Key
              label="⌫"
              onPress={() => onDigit('⌫')}
              testID="keypad-backspace"
              height={keyHeight}
            />
          )}
          {rowIndex === 1 &&
            (props.compact ? (
              <Spacer />
            ) : (
              <Key
                label={props.dateLabel}
                onPress={props.onDatePress}
                small={props.dateCompact}
                testID="keypad-date"
                height={keyHeight}
              />
            ))}
          {rowIndex === 2 &&
            (props.compact ? (
              <Spacer />
            ) : (
              <Key
                label={props.moreHasValue ? `${tr('capture.more')} ●` : tr('capture.more')}
                onPress={props.onMorePress}
                testID="keypad-more"
                height={keyHeight}
              />
            ))}
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
