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
  return ask(title, actionLabel, 'destructive', message);
}

/**
 * The same prompt for a change that is big but not destructive — auto-filling every envelope at
 * once. Same shape, without the red button: nothing is being deleted.
 */
export function confirmAction(
  title: string,
  actionLabel: string,
  message?: string,
): Promise<boolean> {
  return ask(title, actionLabel, 'default', message);
}

function ask(
  title: string,
  actionLabel: string,
  style: 'destructive' | 'default',
  message?: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: i18n.t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
        { text: actionLabel, style, onPress: () => resolve(true) },
      ],
      { onDismiss: () => resolve(false) },
    );
  });
}
