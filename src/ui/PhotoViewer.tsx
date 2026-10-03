// A receipt photo full screen, tapped anywhere to close. Used by the draft and transaction screens.
// `onDelete` adds the one way out of a wrong photo (#69) — a blurry shot, the wrong receipt, a
// duplicate; the caller asks for confirmation, since what it removes differs (a draft's own file,
// or an attachment in Firefly III).
import { useTranslation } from 'react-i18next';
import { Image, Modal, Pressable, View } from 'react-native';
import { Button } from './components';
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
      {!!onDelete && !!uri && (
        <View style={{ padding: t.space.lg, backgroundColor: t.color.photoBackdrop }}>
          <Button title={tr('capture.removePhoto')} variant="danger" onPress={onDelete} />
        </View>
      )}
    </Modal>
  );
}
