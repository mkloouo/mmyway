// Signs in from a link — mmyway-dev://e2e-sign-in?host=…&token=… — so the Maestro flows don't type
// a thousand-character token key by key (src/e2e/signInLink.ts has the why). Answers in the Dev
// build only: in any other build this route sends you home without reading the link.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { e2eLinksEnabled, signInLinkParams } from '../src/e2e/signInLink';
import { useDb } from '../src/providers/DbProvider';
import { connectFailureText, connectToInstance } from '../src/settings/connectInstance';
import { SETTINGS_QUERY_KEY } from '../src/settings/loadSettings';
import { useSync } from '../src/sync/useSync';
import { Button, Screen } from '../src/ui/components';
import { useTheme } from '../src/ui/theme';
import { errorMessage } from '../src/utils/errorMessage';

type State =
  | { kind: 'connecting' }
  | { kind: 'connected' }
  | { kind: 'failed'; title: string; message: string };

export default function E2eSignIn() {
  if (!e2eLinksEnabled(Constants.expoConfig?.extra?.appVariant)) return <Redirect href="/" />;
  return <SignInFromLink />;
}

function SignInFromLink() {
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const queryClient = useQueryClient();
  const { credentialsChanged } = useSync();
  const params = useLocalSearchParams();
  const [state, setState] = useState<State>({ kind: 'connecting' });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const { host, token } = signInLinkParams(params);
        const result = await connectToInstance(db, host, token);
        if (result.status !== 'connected') {
          setState({ kind: 'failed', ...connectFailureText(result) });
          return;
        }
        await queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });
        credentialsChanged();
        setState({ kind: 'connected' });
      } catch (err) {
        setState({
          kind: 'failed',
          title: tr('settings.signInFailed'),
          message: errorMessage(err),
        });
      }
    })();
  }, [db, params, queryClient, credentialsChanged, tr]);

  // Stays on screen until dismissed, so a run (or a person watching it) sees how it ended.
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <Screen>
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          gap: t.space.lg,
          padding: t.space.xxl,
        }}
      >
        {state.kind === 'connecting' && (
          <>
            <ActivityIndicator size="large" color={t.color.accent} />
            <Text style={[t.type.body, { color: t.color.textMuted }]}>
              {tr('settings.connecting')}
            </Text>
          </>
        )}
        {state.kind === 'connected' && (
          <>
            <Text style={[t.type.heading, { color: t.color.text }]}>
              {tr('settings.connected')}
            </Text>
            <Button title={tr('common.done')} onPress={close} />
          </>
        )}
        {state.kind === 'failed' && (
          <>
            <Text style={[t.type.heading, { color: t.color.text }]}>{state.title}</Text>
            <Text style={[t.type.body, { color: t.color.textMuted, textAlign: 'center' }]}>
              {state.message}
            </Text>
            <Button title={tr('common.close')} onPress={close} />
          </>
        )}
      </View>
    </Screen>
  );
}
