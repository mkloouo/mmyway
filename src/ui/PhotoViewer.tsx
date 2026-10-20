// A receipt photo full screen. Used by the draft and transaction screens.
// `onDelete` adds the one way out of a wrong photo (#69) — a blurry shot, the wrong receipt, a
// duplicate; the caller asks for confirmation, since what it removes differs (a draft's own file,
// or an attachment in Firefly III).
import { useTranslation } from 'react-i18next';
import { Image, Modal, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, IconButton } from './kit';
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
          <IconButton
            icon="close"
            size={20}
            color={t.color.onPhoto}
            accessibilityLabel={tr('common.close')}
            onPress={onClose}
          />
          <Text style={{ flex: 1, fontSize: 17, fontWeight: '600', color: t.color.onPhoto }}>
            {tr('draft.receipt')}
          </Text>
        </View>

        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          {!!uri && (
            <Image
              source={{ uri }}
              resizeMode="contain"
              style={{ width: '100%', height: '100%', borderRadius: 4 }}
            />
          )}
        </View>

        {!!onDelete && !!uri && (
          <View
            style={{
              paddingHorizontal: 16,
              paddingBottom: Math.max(insets.bottom, 24),
              paddingTop: 8,
            }}
          >
            <Button
              title={tr('capture.removePhoto')}
              variant="photoDanger"
              size="lg"
              icon="trash-outline"
              onPress={onDelete}
            />
          </View>
        )}
      </View>
    </Modal>
  );
}
