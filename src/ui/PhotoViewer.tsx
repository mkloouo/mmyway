// A receipt photo full screen, tapped anywhere to close. Used by the draft and transaction screens.
// `onDelete` adds the one way out of a wrong photo (#69) — a blurry shot, the wrong receipt, a
// duplicate; the caller asks for confirmation, since what it removes differs (a draft's own file,
// or an attachment in Firefly III).
import { useTranslation } from 'react-i18next';
import { Image, Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from './theme';

export function PhotoViewer({
  uri,
  onClose,
  onDelete,
}: {
  uri: string | null;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={!!uri} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.color.photoBackdrop }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            height: 56 + insets.top,
            paddingTop: insets.top,
            paddingHorizontal: 8,
            gap: 4,
          }}
        >
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={tr('common.close')}
            hitSlop={8}
            style={{
              width: 44,
              height: 44,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="close" size={20} color={t.color.onPhoto} />
          </Pressable>
          <Text style={{ flex: 1, fontSize: 17, fontWeight: '600', color: t.color.onPhoto }}>
            {tr('capture.receiptPhoto')}
          </Text>
        </View>

        <Pressable
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onPress={onClose}
          accessibilityLabel={tr('draft.closePhoto')}
        >
          {!!uri && (
            <Image
              source={{ uri }}
              resizeMode="contain"
              style={{ width: '100%', height: '100%', borderRadius: 4 }}
            />
          )}
        </Pressable>

        {!!onDelete && !!uri && (
          <View
            style={{
              paddingHorizontal: 16,
              paddingBottom: Math.max(insets.bottom, 24),
              paddingTop: 8,
            }}
          >
            <Pressable
              onPress={onDelete}
              accessibilityRole="button"
              accessibilityLabel={tr('capture.removePhoto')}
              style={{
                height: 52,
                borderRadius: 14,
                backgroundColor: t.color.photoControl,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <Ionicons name="trash-outline" size={18} color={t.color.onPhotoDanger} />
              <Text style={{ color: t.color.onPhotoDanger, fontSize: 16, fontWeight: '600' }}>
                {tr('capture.removePhoto')}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}
