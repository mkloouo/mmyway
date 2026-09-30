// One photo picker for every place that takes a receipt image: the receipt screen, capture's
// Details, a draft, a synced transaction.
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import i18n from '../i18n';
import { exifTakenAt } from './exifDate';

export type PhotoSource = 'camera' | 'gallery';

/** `takenAt`: when the photo was taken, from its EXIF, if it says. */
export async function pickPhoto(
  source: PhotoSource,
): Promise<{ uri: string; base64: string; takenAt?: string } | null> {
  const permission =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.7, exif: true })
      : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.7, exif: true });
  const asset = result.canceled ? undefined : result.assets[0];
  return asset?.base64
    ? { uri: asset.uri, base64: asset.base64, takenAt: exifTakenAt(asset.exif) }
    : null;
}

/** Asks "camera or gallery?" and resolves with the choice (null on cancel). */
export function askPhotoSource(
  title = i18n.t('photo.addReceiptPhoto'),
): Promise<PhotoSource | null> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      undefined,
      [
        { text: i18n.t('common.cancel'), style: 'cancel', onPress: () => resolve(null) },
        { text: i18n.t('photo.gallery'), onPress: () => resolve('gallery') },
        { text: i18n.t('photo.camera'), onPress: () => resolve('camera') },
      ],
      { onDismiss: () => resolve(null) },
    );
  });
}
