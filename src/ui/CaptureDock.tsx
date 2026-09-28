// Floating over Inbox and Activity, never Settings (design §5).
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from './theme';
import { navigateOnce } from './navigateOnce';

export function CaptureDock() {
  const t = useTheme();
  const { t: tr } = useTranslation();
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        right: t.space.lg,
        bottom: t.space.lg,
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space.md,
      }}
    >
      <Pressable
        onPress={() => navigateOnce({ pathname: '/receipt', params: { source: 'gallery' } })}
        accessibilityRole="button"
        accessibilityLabel={tr('dock.receiptFromGallery')}
        style={({ pressed }) => ({
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: t.color.surface,
          borderWidth: 1,
          borderColor: t.color.border,
          opacity: pressed ? 0.6 : 1,
          elevation: 3,
        })}
      >
        <Ionicons name="images" size={20} color={t.color.text} />
      </Pressable>
      <Pressable
        onPress={() => navigateOnce('/receipt')}
        accessibilityRole="button"
        accessibilityLabel={tr('dock.captureReceipt')}
        style={({ pressed }) => ({
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: t.color.surface,
          borderWidth: 1,
          borderColor: t.color.border,
          opacity: pressed ? 0.6 : 1,
          elevation: 3,
        })}
      >
        <Ionicons name="camera" size={20} color={t.color.text} />
      </Pressable>
      <Pressable
        onPress={() => navigateOnce('/capture')}
        accessibilityRole="button"
        accessibilityLabel={tr('dock.addEntry')}
        style={({ pressed }) => ({
          height: 56,
          paddingHorizontal: t.space.xl,
          borderRadius: t.radius.pill,
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.space.sm,
          backgroundColor: t.color.accent,
          opacity: pressed ? 0.6 : 1,
          elevation: 3,
        })}
      >
        <Ionicons name="add" size={20} color={t.color.onAccent} />
        <Text style={[t.type.heading, { color: t.color.onAccent }]}>{tr('common.add')}</Text>
      </Pressable>
    </View>
  );
}
