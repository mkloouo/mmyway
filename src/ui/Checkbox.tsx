// A labelled checkbox row with a hint line (the account page's switches).
import { Pressable, Text, View } from 'react-native';
import { useTheme } from './theme';

export function Checkbox({ checked, onPress, label, hint }: { checked: boolean; onPress: () => void; label: string; hint: string }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md, paddingVertical: t.space.md }}
    >
      <View
        style={{
          width: 22, height: 22, borderRadius: t.radius.sm, borderWidth: 1.5,
          borderColor: checked ? t.color.accent : t.color.border,
          backgroundColor: checked ? t.color.accent : 'transparent',
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        {checked && <Text style={{ color: t.color.onAccent, fontSize: 14 }}>✓</Text>}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[t.type.body, { color: t.color.text }]}>{label}</Text>
        <Text style={[t.type.label, { color: t.color.textMuted }]}>{hint}</Text>
      </View>
    </Pressable>
  );
}
