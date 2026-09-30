import { Alert } from 'react-native';
import i18n from '../i18n';
import type { discardOperation } from '../sync/outbox';

/** Tells the user why a Cancel didn't remove anything; a discarded change needs no word. */
export function alertDiscardOutcome(outcome: Awaited<ReturnType<typeof discardOperation>>): void {
  if (outcome === 'sending')
    Alert.alert(i18n.t('inbox.alreadySending'), i18n.t('inbox.alreadySendingBody'));
  else if (outcome === 'landed')
    Alert.alert(i18n.t('inbox.alreadyLanded'), i18n.t('inbox.alreadyLandedBody'));
  else if (outcome === 'unreachable')
    Alert.alert(i18n.t('inbox.cantCheck'), i18n.t('inbox.cantCheckBody'));
}
