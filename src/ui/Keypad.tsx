// The 4x4 grid of design §6.2: digits plus the date, note and save cells share its layout so
// the whole bottom cluster reads as one control.
import { useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from './theme';
import { haptics } from './haptics';
import type { KeypadKey } from '../capture/amountInput';

const DIGIT_ROWS: KeypadKey[][] = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], [',', '0', '00']];

function Key({ label, onPress, tone, disabled }: { label: string; onPress: () => void; tone?: 'default' | 'accent'; disabled?: boolean }) {
  const t = useTheme();
  const isAccent = tone === 'accent';
  // The key shrinks under the finger with the buzz: the same moment felt and seen, so a phone
  // without a vibration motor still shows that the press landed.
  const [scale] = useState(() => new Animated.Value(1));
  const press = (to: number) => Animated.spring(scale, { toValue: to, speed: 40, bounciness: 6, useNativeDriver: true }).start();
  return (
    <Animated.View style={{ flex: 1, marginHorizontal: 4, marginVertical: 4, transform: [{ scale }] }}>
    <Pressable
      // On press-in, not release: the buzz lands with the finger, the way a keyboard's does.
      onPressIn={() => { void haptics.key(); press(0.9); }}
      onPressOut={() => press(1)}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        aspectRatio: 1.4,
        borderRadius: t.radius.sm, alignItems: 'center', justifyContent: 'center',
        backgroundColor: isAccent ? t.color.accent : t.color.surfaceAlt,
        opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
      })}
    >
      <Text
        style={[t.type.heading, { color: isAccent ? t.color.onAccent : t.color.text, textAlign: 'center' }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
    </Animated.View>
  );
}

export function Keypad({
  onDigit, dateLabel, onDatePress, onNotePress, noteHasValue, saveLabel, onSave, saveDisabled, saving, compact,
}: {
  onDigit: (key: KeypadKey) => void;
  dateLabel?: string;
  onDatePress?: () => void;
  onNotePress?: () => void;
  noteHasValue?: boolean;
  saveLabel: string;
  onSave: () => void;
  saveDisabled?: boolean;
  saving?: boolean;
  /** Digits, backspace and a single confirm cell — no date/note cells (a sheet's amount edit). */
  compact?: boolean;
}) {
  const { t: tr } = useTranslation();
  return (
    <View>
      {DIGIT_ROWS.map((row, rowIndex) => (
        <View key={rowIndex} style={{ flexDirection: 'row' }}>
          {row.map((key) => <Key key={key} label={key} onPress={() => onDigit(key)} />)}
          {rowIndex === 0 && <Key label="⌫" onPress={() => onDigit('⌫')} />}
          {rowIndex === 1 && (compact ? <View style={{ flex: 1, marginHorizontal: 4, marginVertical: 4 }} /> : <Key label={dateLabel!} onPress={onDatePress!} />)}
          {rowIndex === 2 && (compact ? <View style={{ flex: 1, marginHorizontal: 4, marginVertical: 4 }} /> : <Key label={noteHasValue ? `${tr('fields.note')} ●` : tr('fields.note')} onPress={onNotePress!} />)}
          {rowIndex === 3 && <Key label={saveLabel} tone="accent" onPress={onSave} disabled={saveDisabled || saving} />}
        </View>
      ))}
    </View>
  );
}
