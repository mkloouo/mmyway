// The 4x4 grid of design §6.2: digits plus the date, note and save cells share its layout so
// the whole bottom cluster reads as one control.
import { Pressable, Text, View } from 'react-native';
import { useTheme } from './theme';
import { haptics } from './haptics';
import type { KeypadKey } from '../capture/amountInput';

const DIGIT_ROWS: KeypadKey[][] = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], [',', '0', '00']];

function Key({ label, onPress, tone, disabled }: { label: string; onPress: () => void; tone?: 'default' | 'accent'; disabled?: boolean }) {
  const t = useTheme();
  const isAccent = tone === 'accent';
  return (
    <Pressable
      // On press-in, not release: the buzz lands with the finger, the way a keyboard's does.
      onPressIn={() => { void haptics.key(); }}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flex: 1, aspectRatio: 1.4, marginHorizontal: 4, marginVertical: 4,
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
  return (
    <View>
      {DIGIT_ROWS.map((row, rowIndex) => (
        <View key={rowIndex} style={{ flexDirection: 'row' }}>
          {row.map((key) => <Key key={key} label={key} onPress={() => onDigit(key)} />)}
          {rowIndex === 0 && <Key label="⌫" onPress={() => onDigit('⌫')} />}
          {rowIndex === 1 && (compact ? <View style={{ flex: 1, marginHorizontal: 4, marginVertical: 4 }} /> : <Key label={dateLabel!} onPress={onDatePress!} />)}
          {rowIndex === 2 && (compact ? <View style={{ flex: 1, marginHorizontal: 4, marginVertical: 4 }} /> : <Key label={noteHasValue ? 'Note ●' : 'Note'} onPress={onNotePress!} />)}
          {rowIndex === 3 && <Key label={saveLabel} tone="accent" onPress={onSave} disabled={saveDisabled || saving} />}
        </View>
      ))}
    </View>
  );
}
