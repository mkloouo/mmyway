// Floating over Inbox and Activity, never Settings (design §5).
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from './theme';
import { Fab, PRESSED_OPACITY } from './components';
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
      <Fab
        icon="images"
        label={tr('dock.receiptFromGallery')}
        onPress={() => navigateOnce({ pathname: '/receipt', params: { source: 'gallery' } })}
      />
      <Fab
        icon="camera"
        label={tr('dock.captureReceipt')}
        onPress={() => navigateOnce('/receipt')}
      />
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
          opacity: pressed ? PRESSED_OPACITY : 1,
          elevation: 3,
        })}
      >
        <Ionicons name="add" size={20} color={t.color.onAccent} />
        <Text style={[t.type.heading, { color: t.color.onAccent }]}>{tr('common.add')}</Text>
      </Pressable>
    </View>
  );
}
