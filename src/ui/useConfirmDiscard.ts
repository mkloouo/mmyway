// "You have unsaved changes" on the way out, for the two screens that edit a form: Capture and an
// account's page. Returns the close handler; the Android back button goes through the same one.
import { useCallback, useEffect } from 'react';
import { Alert, BackHandler } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

export function useConfirmDiscard(dirty: boolean, titleKey: string): () => void {
  const { t: tr } = useTranslation();

  const close = useCallback(() => {
    if (!dirty) {
      router.back();
      return;
    }
    Alert.alert(tr(titleKey), undefined, [
      { text: tr('capture.keepEditing'), style: 'cancel' },
      { text: tr('inbox.discard'), style: 'destructive', onPress: () => router.back() },
    ]);
  }, [dirty, titleKey, tr]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!dirty) return false;
      close();
      return true;
    });
    return () => sub.remove();
  }, [dirty, close]);

  return close;
}
