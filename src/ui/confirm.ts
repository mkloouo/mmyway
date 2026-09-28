import { Alert } from 'react-native';
import i18n from '../i18n';

/**
 * One confirmation prompt for every destructive control, so a delete reads the same wherever it
 * is triggered — a button, a row's ✕, or a completed swipe. Resolves false on cancel and on an
 * Android back-dismiss.
 */
export function confirmDestructive(
  title: string,
  actionLabel: string,
  message?: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: i18n.t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
        { text: actionLabel, style: 'destructive', onPress: () => resolve(true) },
      ],
      { onDismiss: () => resolve(false) },
    );
  });
}
