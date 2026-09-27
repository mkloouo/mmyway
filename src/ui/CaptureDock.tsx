// Floating over Inbox and Activity, never Settings (design §5).
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from './theme';

export function CaptureDock() {
  const t = useTheme();
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute', right: t.space.lg, bottom: t.space.lg,
        flexDirection: 'row', alignItems: 'center', gap: t.space.md,
      }}
    >
      <Pressable
        onPress={() => router.push('/receipt')}
        accessibilityRole="button"
        accessibilityLabel="Capture a receipt"
        style={({ pressed }) => ({
          width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
          backgroundColor: t.color.surface, borderWidth: 1, borderColor: t.color.border,
          opacity: pressed ? 0.6 : 1, elevation: 3,
        })}
      >
        <Ionicons name="camera" size={20} color={t.color.text} />
      </Pressable>
      <Pressable
        onPress={() => router.push('/capture')}
        accessibilityRole="button"
        accessibilityLabel="Add an entry"
        style={({ pressed }) => ({
          height: 56, paddingHorizontal: t.space.xl, borderRadius: t.radius.pill,
          flexDirection: 'row', alignItems: 'center', gap: t.space.sm,
          backgroundColor: t.color.accent, opacity: pressed ? 0.6 : 1, elevation: 3,
        })}
      >
        <Ionicons name="add" size={20} color={t.color.onAccent} />
        <Text style={[t.type.heading, { color: t.color.onAccent }]}>Add</Text>
      </Pressable>
    </View>
  );
}
