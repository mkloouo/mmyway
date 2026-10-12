// A receipt photo full screen, tapped anywhere to close. Used by the draft and transaction screens.
// `onDelete` adds the one way out of a wrong photo (#69) — a blurry shot, the wrong receipt, a
// duplicate; the caller asks for confirmation, since what it removes differs (a draft's own file,
// or an attachment in Firefly III).
import { useTranslation } from 'react-i18next';
import { Image, Modal, Pressable, Text, View } from 'react-native';
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
  return (
    <Modal visible={!!uri} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: t.color.photoBackdrop, justifyContent: 'center' }}
        onPress={onClose}
        accessibilityLabel={tr('draft.closePhoto')}
      >
        {!!uri && (
          <Image source={{ uri }} resizeMode="contain" style={{ width: '100%', height: '100%' }} />
        )}
      </Pressable>
      {!!uri && (
        <Pressable
          onPress={onClose}
          accessibilityLabel={tr('draft.closePhoto')}
          style={{
            position: 'absolute',
            top: 54,
            right: 16,
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: 'rgba(0,0,0,0.5)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name="close" size={20} color="#FFFFFF" />
        </Pressable>
      )}
      {!!onDelete && !!uri && (
        <View
          style={{
            padding: t.space.lg,
            backgroundColor: t.color.photoBackdrop,
            alignItems: 'center',
          }}
        >
          <Pressable
            onPress={onDelete}
            style={{
              backgroundColor: 'rgba(255,255,255,0.15)',
              paddingHorizontal: 20,
              paddingVertical: 10,
              borderRadius: 999,
            }}
          >
            <Text style={{ color: t.color.danger, fontWeight: '600', fontSize: 16 }}>
              {tr('capture.removePhoto')}
            </Text>
          </Pressable>
        </View>
      )}
    </Modal>
  );
}
