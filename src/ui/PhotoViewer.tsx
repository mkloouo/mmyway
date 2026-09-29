// A receipt photo full screen, tapped anywhere to close. Used by the draft and transaction screens.
import { useTranslation } from 'react-i18next';
import { Image, Modal, Pressable } from 'react-native';
import { useTheme } from './theme';

export function PhotoViewer({ uri, onClose }: { uri: string | null; onClose: () => void }) {
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
    </Modal>
  );
}
