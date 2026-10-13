// Settings → Your Firefly III: connection status, the addresses the app tries, sign-in, the reverse
// proxy, the demo, and sign-out. Moved here from the Settings page's Connection section.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Linking, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDb } from '../../src/providers/DbProvider';
import { useTheme } from '../../src/ui/theme';
import {
  Screen,
  Card,
  Button,
  Dot,
  Sheet,
  SectionHeader,
  Toast,
  SCREEN_TOP_PADDING,
} from '../../src/ui/components';
import { PushHeader, ListRow, GroupFooter } from '../../src/ui/kit';
import { AddressesSheet } from '../../src/ui/AddressesSheet';
import { relativeTime } from '../../src/ui/relativeTime';
import { TextField } from '../../src/ui/TextField';
import { useAction } from '../../src/ui/useAction';
import { confirmAction, confirmDestructive } from '../../src/ui/confirm';
import { useToast } from '../../src/ui/useToast';
import { loadSettings, SETTINGS_QUERY_KEY } from '../../src/settings/loadSettings';
import { signOut, readStoredCredentials, probeAbout } from '../../src/api/ff3/auth';
import { writeHosts } from '../../src/api/ff3/hosts';
import { connectFailureText, connectToInstance } from '../../src/settings/connectInstance';
import { getDemoMode } from '../../src/settings/appSettings';
import { useFlags } from '../../src/flags/useFlag';
import { useSync } from '../../src/sync/useSync';
import { withSyncPaused } from '../../src/sync/runSync';
import {
  clearInstanceData,
  describeQueuedOperations,
  queuedOperationCount,
} from '../../src/sync/instanceData';
import { leaveDemo, startDemo } from '../../src/demo/demo';

function shortLabel(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export default function ConnectionScreen() {
  const db = useDb();
  const { credentialsChanged, status, syncNow } = useSync();
  const syncing = status === 'syncing';
  const t = useTheme();
  const { t: tr } = useTranslation();
  const act = useAction();
  const flags = useFlags();

  const { data: settings } = useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: () => loadSettings(db),
  });
  const queryClient = useQueryClient();
  /** Re-reads every setting. Called after a write and when a sheet that wrote one closes. */
  const reload = () => {
    void queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });
  };

  // Its own query rather than a field of loadSettings: reload() invalidates it with the rest.
  const demoMode = useQuery({
    queryKey: [...SETTINGS_QUERY_KEY, 'demo'],
    queryFn: () => getDemoMode(db),
  });
  const demo = demoMode.data ?? false;
  const signedIn = settings?.signedIn ?? false;
  const ff3Hosts = settings?.ff3Hosts ?? [];
  const proxyHeaderCount = settings?.proxyHeaderCount ?? 0;
  const ff3ActiveHost = settings?.ff3ActiveHost ?? null;
  const lastSyncedAt = settings?.lastSyncedAt ?? null;

  const [toast, setToast] = useToast();

  // Only one sheet is ever open, so it is one state rather than a boolean each.
  const [sheet, setSheet] = useState<'signIn' | 'ff3Addresses' | null>(null);

  const [host, setHost] = useState('');
  const [token, setToken] = useState('');

  const signingIn = act.pending(tr('settings.signIn'));

  const onSignIn = act(tr('settings.signIn'), async () => {
    const result = await connectToInstance(db, host, token);
    if (result.status === 'connected') {
      setSheet(null);
      setToast(tr('settings.connected'));
      setHost('');
      setToken('');
      await reload();
      credentialsChanged();
    } else {
      const { title, message } = connectFailureText(result);
      Alert.alert(title, message);
    }
  });

  const onSignOut = act(tr('settings.signOut'), async () => {
    const queued = await queuedOperationCount(db);
    if (queued > 0) {
      Alert.alert(tr('settings.cantSignOutYet'), describeQueuedOperations(queued));
      return;
    }
    if (
      !(await confirmDestructive(
        tr('settings.signOutTitle'),
        tr('settings.signOut'),
        tr('settings.signOutBody'),
      ))
    )
      return;
    // Re-checked: a write can be queued while the dialog is open.
    const nowQueued = await queuedOperationCount(db);
    if (nowQueued > 0) {
      Alert.alert(tr('settings.cantSignOutYet'), describeQueuedOperations(nowQueued));
      return;
    }
    await withSyncPaused(async () => {
      await signOut();
      await clearInstanceData(db);
    });
    await reload();
    credentialsChanged();
  });

  const onTryDemo = act(tr('demo.tryAction'), async () => {
    if (!(await confirmAction(tr('demo.tryTitle'), tr('demo.tryAction'), tr('demo.tryBody'))))
      return;
    const result = await startDemo(db);
    if (result.status === 'has_data') {
      Alert.alert(tr('demo.hasDataTitle'), tr('demo.hasDataBody'));
      return;
    }
    await reload();
    if (result.status === 'started') setToast(tr('demo.loaded'));
  });

  const onLeaveDemo = act(tr('demo.leaveAction'), async () => {
    if (
      !(await confirmDestructive(
        tr('demo.leaveTitle'),
        tr('demo.leaveAction'),
        tr('demo.leaveBody'),
      ))
    )
      return;
    await withSyncPaused(() => leaveDemo(db));
    await reload();
  });

  // Kept while the settings load, like the sign-out row, so the page keeps its height.
  const showTryDemo = flags.demo_mode && (!settings || (!signedIn && !demo));

  // The address the app is using now, the one "Open in browser" opens.
  const activeHost = ff3ActiveHost ?? ff3Hosts[0] ?? null;
  const onOpenBrowser = act(tr('settings.openInBrowser'), async () => {
    if (activeHost) await Linking.openURL(activeHost);
  });

  return (
    <Screen>
      <PushHeader
        backLabel={tr('settings.title')}
        onBack={() => router.back()}
        title={tr('settings.connectionTitle')}
      />
      <ScrollView
        contentContainerStyle={{ paddingBottom: t.space.xxl, paddingTop: SCREEN_TOP_PADDING }}
      >
        <Card flush style={{ marginHorizontal: t.space.lg }}>
          <ListRow
            first
            leading={<Dot color={signedIn || demo ? t.color.income : t.color.warn} />}
            label={
              demo
                ? tr('demo.value')
                : signedIn
                  ? tr('settings.connectedValue')
                  : tr('settings.notConnected')
            }
            sub={`${tr('settings.lastSync')}: ${relativeTime(lastSyncedAt)}`}
            onPress={() => setSheet('signIn')}
            chevron
          />
        </Card>

        <View
          style={{
            flexDirection: 'row',
            gap: t.space.sm,
            marginHorizontal: t.space.lg,
            marginTop: t.space.md,
          }}
        >
          <Button
            title={syncing ? tr('sync.syncing') : tr('sync.syncNow')}
            onPress={() => void syncNow()}
            disabled={syncing}
            style={{ flex: 1 }}
          />
          <Button
            title={tr('settings.openInBrowser')}
            variant="secondary"
            onPress={() => void onOpenBrowser()}
            disabled={!activeHost}
            style={{ flex: 1 }}
          />
        </View>

        {(showTryDemo || demo) && (
          <Card flush style={{ marginHorizontal: t.space.lg, marginTop: t.space.md }}>
            {showTryDemo && (
              <ListRow
                first
                label={tr('demo.tryAction')}
                onPress={settings ? onTryDemo : undefined}
              />
            )}
            {demo && (
              <ListRow
                first={!showTryDemo}
                label={tr('demo.leaveAction')}
                tone="danger"
                onPress={onLeaveDemo}
              />
            )}
          </Card>
        )}

        <Card flush style={{ marginHorizontal: t.space.lg, marginTop: t.space.md }}>
          <ListRow
            first
            label={tr('settings.addresses')}
            trailing={
              <Text style={[t.type.body, { color: t.color.textMuted }]}>
                {ff3Hosts.length > 0
                  ? `${shortLabel(ff3ActiveHost ?? ff3Hosts[0]!)}${ff3Hosts.length > 1 ? ` +${ff3Hosts.length - 1}` : ''}`
                  : tr('settings.none')}
              </Text>
            }
            chevron
            onPress={() => setSheet('ff3Addresses')}
          />
        </Card>
        <GroupFooter>{tr('settings.addressesHint')}</GroupFooter>

        <SectionHeader title={tr('settings.sectionAccess')} />
        <Card flush style={{ marginHorizontal: t.space.lg }}>
          <ListRow
            first
            label={signedIn ? tr('settings.accessToken') : tr('settings.signIn')}
            chevron
            onPress={() => setSheet('signIn')}
          />
          {flags.reverse_proxy && (
            <ListRow
              label={tr('proxy.title')}
              trailing={
                <Text style={[t.type.body, { color: t.color.textMuted }]}>
                  {proxyHeaderCount > 0
                    ? tr('proxy.headerCount', { count: proxyHeaderCount })
                    : tr('settings.none')}
                </Text>
              }
              chevron
              onPress={() => router.push('/settings/proxy')}
            />
          )}
        </Card>

        {/* The row is kept while the settings load, so the page is its final height on the first frame. */}
        {(signedIn || !settings) && (
          <>
            <SectionHeader title={tr('settings.account')} />
            <Card flush style={{ marginHorizontal: t.space.lg }}>
              <ListRow
                first
                label={tr('settings.signOut')}
                tone="danger"
                onPress={settings ? onSignOut : undefined}
              />
            </Card>
            <GroupFooter>{tr('settings.signOutHint')}</GroupFooter>
          </>
        )}
      </ScrollView>

      <Toast message={toast} />

      <Sheet
        visible={sheet === 'signIn'}
        onClose={() => setSheet(null)}
        title="Firefly III"
        footer={
          <Button
            title={signingIn ? tr('settings.connecting') : tr('settings.signIn')}
            onPress={onSignIn}
            disabled={signingIn}
          />
        }
      >
        <TextField
          value={host}
          onChangeText={setHost}
          placeholder="https://firefly.example.com"
          autoCapitalize="none"
        />
        <TextField
          value={token}
          onChangeText={setToken}
          placeholder={tr('settings.tokenPlaceholder')}
          secureTextEntry
          autoCapitalize="none"
          style={{ marginTop: t.space.sm }}
        />
      </Sheet>

      <AddressesSheet
        visible={sheet === 'ff3Addresses'}
        onClose={() => {
          setSheet(null);
          reload();
        }}
        title={tr('settings.ff3Addresses')}
        addresses={ff3Hosts}
        activeAddress={ff3ActiveHost}
        onSave={async (list) => {
          await writeHosts(list);
          await reload();
        }}
        probe={async (address) => {
          const stored = await readStoredCredentials();
          if (!stored) return false;
          return (await probeAbout(address, stored.apiToken)).ok;
        }}
      />
    </Screen>
  );
}
