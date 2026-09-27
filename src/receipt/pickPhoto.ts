// One photo picker for every place that takes a receipt image: the receipt screen, capture's
// Details, a draft, a synced transaction.
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

export type PhotoSource = 'camera' | 'gallery';

export async function pickPhoto(source: PhotoSource): Promise<{ uri: string; base64: string } | null> {
  const permission = source === 'camera'
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;
  const result = source === 'camera'
    ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.7 })
    : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.7 });
  const asset = result.canceled ? undefined : result.assets[0];
  return asset?.base64 ? { uri: asset.uri, base64: asset.base64 } : null;
}

/** Asks "camera or gallery?" and resolves with the choice (null on cancel). */
export function askPhotoSource(title = 'Add a receipt photo'): Promise<PhotoSource | null> {
  return new Promise((resolve) => {
    Alert.alert(title, undefined, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
      { text: 'Gallery', onPress: () => resolve('gallery') },
      { text: 'Camera', onPress: () => resolve('camera') },
    ], { onDismiss: () => resolve(null) });
  });
}
