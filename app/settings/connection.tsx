// Settings → Your Firefly III: connection status card, inline addresses with probing,
// masked access token, reverse proxy headers, and sign-out. (V4 board 29)
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Linking, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDb } from '../../src/providers/DbProvider';
import { useTheme } from '../../src/ui/theme';
import {
  Button,
  Card,
  Dot,
  GroupFooter,
  ListRow,
  PushHeader,
  SCREEN_TOP_PADDING,
  Screen,
  SectionHeader,
  Toast,
} from '../../src/ui/kit';
import {
  AddressEditSheet,
  AddressRow,
  type AddressStatus,
  SignInSheet,
  TestAllButton,
} from '../../src/ui/AddressesSheet';
import { relativeTime } from '../../src/ui/relativeTime';
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
  const reload = () => {
    void queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: ['storedCredentials'] });
    void queryClient.invalidateQueries({ queryKey: ['queuedOperationCount'] });
  };

  const credsQuery = useQuery({
    queryKey: ['storedCredentials'],
    queryFn: () => readStoredCredentials(),
  });
  const creds = credsQuery.data;
  const tokenTail = creds?.apiToken
    ? creds.apiToken.length >= 4
      ? creds.apiToken.slice(-4)
      : creds.apiToken
    : null;

  const queuedQuery = useQuery({
    queryKey: ['queuedOperationCount'],
    queryFn: () => queuedOperationCount(db),
  });
  const queuedCount = queuedQuery.data ?? 0;

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
  const [sheet, setSheet] = useState<'signIn' | 'address' | null>(null);
  const [editingAddress, setEditingAddress] = useState<string | null>(null);
  const [addressStatus, setAddressStatus] = useState<Record<string, AddressStatus>>({});

  const [host, setHost] = useState('');
  const [token, setToken] = useState('');

  const signingIn = act.pending(tr('settings.signIn'));
  const testingAll = act.pending(tr('addresses.testAll'));

  const onSignIn = act(tr('settings.signIn'), async () => {
    const result = await connectToInstance(db, host, token);
    if (result.status === 'connected') {
      setSheet(null);
      setToast(tr('settings.connected'));
      setHost('');
      setToken('');
      reload();
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
    const nowQueued = await queuedOperationCount(db);
    if (nowQueued > 0) {
      Alert.alert(tr('settings.cantSignOutYet'), describeQueuedOperations(nowQueued));
      return;
    }
    await withSyncPaused(async () => {
      await signOut();
      await clearInstanceData(db);
    });
    reload();
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
    reload();
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
    reload();
  });

  const onTestAll = act(tr('addresses.testAll'), async () => {
    setAddressStatus(Object.fromEntries(ff3Hosts.map((a) => [a, 'probing' as const])));
    const stored = await readStoredCredentials();
    const results = await Promise.all(
      ff3Hosts.map(async (a) => {
        if (!stored) return [a, false] as const;
        const res = await probeAbout(a, stored.apiToken);
        return [a, res.ok] as const;
      }),
    );
    setAddressStatus(Object.fromEntries(results.map(([a, ok]) => [a, ok ? 'ok' : 'down'])));
  });

  const onSaveAddress = async (newOrUpdated: string) => {
    const next = editingAddress
      ? ff3Hosts.map((h) => (h === editingAddress ? newOrUpdated : h))
      : [...ff3Hosts, newOrUpdated];
    await writeHosts(next);
    reload();
    credentialsChanged();
    setSheet(null);
    setEditingAddress(null);
  };

  const onRemoveAddress = async (addressToRemove: string) => {
    const next = ff3Hosts.filter((h) => h !== addressToRemove);
    await writeHosts(next);
    reload();
    credentialsChanged();
    setSheet(null);
    setEditingAddress(null);
  };

  const onMakePrimaryAddress = async (addressToPrimary: string) => {
    const next = [addressToPrimary, ...ff3Hosts.filter((h) => h !== addressToPrimary)];
    await writeHosts(next);
    reload();
    credentialsChanged();
    setSheet(null);
    setEditingAddress(null);
  };

  const showTryDemo = flags.demo_mode && (!settings || (!signedIn && !demo));
  const activeHost = ff3ActiveHost ?? ff3Hosts[0] ?? null;
  const onOpenBrowser = act(tr('settings.openInBrowser'), async () => {
    if (activeHost) await Linking.openURL(activeHost);
  });

  const syncPart = lastSyncedAt
    ? tr('settings.syncedWithTime', { time: relativeTime(lastSyncedAt) })
    : tr('sync.neverSynced');
  const waitingPart =
    queuedCount > 0
      ? tr('sync.waitingToSend', { count: queuedCount })
      : tr('settings.nothingWaitingLower');
  const statusSubtitle =
    signedIn || demo
      ? syncing
        ? tr('sync.syncing')
        : `${syncPart} · ${waitingPart}`
      : tr('sync.notSignedIn');

  return (
    <Screen bottom>
      <PushHeader backLabel={tr('settings.title')} onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={{ paddingBottom: t.space.xxl, paddingTop: SCREEN_TOP_PADDING }}
      >
        <Text
          style={[
            t.type.largeTitle,
            { color: t.color.text, paddingHorizontal: t.space.lg, paddingBottom: t.space.md },
          ]}
        >
          {tr('settings.connectionTitle')}
        </Text>

        {/* Status card (board 29) */}
        <Card style={{ marginHorizontal: t.space.lg, padding: t.space.lg }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
            <Dot color={signedIn || demo ? t.color.income : t.color.warn} />
            <View style={{ flex: 1 }}>
              <Text style={[t.type.heading, { color: t.color.text }]}>
                {demo
                  ? tr('demo.value')
                  : signedIn
                    ? tr('settings.connectedStatus')
                    : tr('settings.notConnected')}
              </Text>
              <Text style={[t.type.label, { color: t.color.textMuted }]}>{statusSubtitle}</Text>
            </View>
          </View>

          <View style={{ flexDirection: 'row', gap: t.space.sm, marginTop: t.space.md }}>
            <Button
              title={syncing ? tr('sync.syncing') : tr('sync.syncNow')}
              onPress={() => void syncNow()}
              disabled={syncing || (!signedIn && !demo)}
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
        </Card>

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

        {/* Addresses inline with status dots and test all (board 29) */}
        <SectionHeader
          title={tr('settings.addresses')}
          action={
            <TestAllButton
              testing={testingAll}
              disabled={testingAll || ff3Hosts.length === 0}
              onPress={() => void onTestAll()}
            />
          }
        />
        <Card flush style={{ marginHorizontal: t.space.lg }}>
          {ff3Hosts.map((addr, index) => (
            <AddressRow
              key={addr}
              address={addr}
              first={index === 0}
              active={addr === activeHost}
              status={addressStatus[addr]}
              onPress={() => {
                setEditingAddress(addr);
                setSheet('address');
              }}
            />
          ))}
          <ListRow
            first={ff3Hosts.length === 0}
            label={tr('addresses.addAddress')}
            tone="accent"
            onPress={() => {
              setEditingAddress(null);
              setSheet('address');
            }}
          />
        </Card>
        <GroupFooter>{tr('settings.addressesHint')}</GroupFooter>

        {/* Access section (board 29) */}
        <SectionHeader title={tr('settings.sectionAccess')} />
        <Card flush style={{ marginHorizontal: t.space.lg }}>
          <ListRow
            first
            label={tr('settings.accessToken')}
            trailing={
              <Text style={[t.type.body, { color: t.color.textMuted }]}>
                {signedIn && tokenTail ? `•••• ${tokenTail}` : tr('settings.none')}
              </Text>
            }
            chevron
            onPress={() => {
              if (activeHost) setHost(activeHost);
              setSheet('signIn');
            }}
          />
          {flags.reverse_proxy && (
            <ListRow
              label={tr('proxy.title')}
              sub={tr('settings.reverseProxySub')}
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

        {/* Account section: always shown (board 29 + decision #15) */}
        <SectionHeader title={tr('settings.account')} />
        <Card flush style={{ marginHorizontal: t.space.lg }}>
          <ListRow
            first
            label={tr('settings.signOut')}
            tone={signedIn ? 'danger' : 'default'}
            onPress={signedIn && settings ? onSignOut : undefined}
          />
        </Card>
        <GroupFooter>{tr('settings.signOutHint')}</GroupFooter>
      </ScrollView>

      <Toast message={toast} />

      <SignInSheet
        visible={sheet === 'signIn'}
        onClose={() => setSheet(null)}
        host={host}
        token={token}
        onChangeHost={setHost}
        onChangeToken={setToken}
        onSubmit={onSignIn}
        signingIn={signingIn}
      />

      <AddressEditSheet
        visible={sheet === 'address'}
        onClose={() => {
          setSheet(null);
          setEditingAddress(null);
        }}
        address={editingAddress}
        isPrimary={editingAddress === activeHost}
        onSave={onSaveAddress}
        onRemove={onRemoveAddress}
        onMakePrimary={onMakePrimaryAddress}
        probe={async (address) => {
          const stored = await readStoredCredentials();
          if (!stored) return false;
          return (await probeAbout(address, stored.apiToken)).ok;
        }}
      />
    </Screen>
  );
}
