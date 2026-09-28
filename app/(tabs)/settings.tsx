// Settings (design §6.6) — grouped Card/Row layout, every › opens a Sheet. No nested FlatLists.
import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useLiveQuery } from '../../src/db/useLiveQuery';
import Constants from 'expo-constants';
import { useDb } from '../../src/providers/DbProvider';
import { useTheme } from '../../src/ui/theme';
import { Screen, AppBar, SectionHeader, Card, Row, Chip, Button, Sheet, Toast } from '../../src/ui/components';
import { AddressesSheet } from '../../src/ui/AddressesSheet';
import { relativeTime } from '../../src/ui/relativeTime';
import { signIn, signOut, readStoredCredentials, probeAbout } from '../../src/api/ff3/auth';
import type { AuthErrorReason } from '../../src/api/ff3/types';
import { readHosts, writeHosts } from '../../src/api/ff3/hosts';
import { saveGeminiKey, readGeminiKey } from '../../src/settings/secrets';
import { referenceCurrencies, aliases as aliasesTable } from '../../src/db/schema';
import { useAssetAccounts } from '../../src/accounts/useAssetAccounts';
import { hasEnvelopeMarker } from '../../src/accounts/envelopeMarker';
import { useSync } from '../../src/sync/useSync';
import { clearInstanceData, describeQueuedOperations, isSameInstance, queuedOperationCount } from '../../src/sync/instanceData';
import {
  getLocalModelBaseUrls, setLocalModelBaseUrls, getLocalModelActiveUrl,
  getLocalModelName, setLocalModelName,
  getDefaultSourceAccountId, setDefaultSourceAccountId,
  getDefaultCurrencyCode, setDefaultCurrencyCode,
  getCashAccountId, setCashAccountId,
  getFf3ActiveHost, getLastSyncedAt,
} from '../../src/settings/appSettings';

const SIGN_IN_ERROR_MESSAGES: Record<AuthErrorReason, string> = {
  invalid_host: "Can't reach that address. Check it's correct and the device has network access.",
  invalid_api_key: 'That token was rejected — check it was copied in full.',
  unexpected_status: 'Firefly III returned an unexpected response. Try again in a moment.',
  not_a_firefly_instance: "That address doesn't look like a Firefly III instance.",
  api_version_too_low: 'This Firefly III instance is running a version too old for the app.',
};

function shortLabel(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export default function SettingsScreen() {
  const db = useDb();
  const { credentialsChanged } = useSync();
  const t = useTheme();

  const allAssetAccounts = useAssetAccounts({ includeInactive: true }) ?? [];
  const assetAccounts = useAssetAccounts() ?? [];
  const { data: currencies } = useLiveQuery(db.select().from(referenceCurrencies));
  const { data: aliasRows } = useLiveQuery(db.select().from(aliasesTable));

  const [signedIn, setSignedIn] = useState(false);
  const [ff3Hosts, setFf3Hosts] = useState<string[]>([]);
  const [ff3ActiveHost, setFf3ActiveHostState] = useState<string | null>(null);
  const [localModelUrls, setLocalModelUrls] = useState<string[]>([]);
  const [localModelActiveUrl, setLocalModelActiveUrlState] = useState<string | null>(null);
  const [localModelName, setLocalModelNameState] = useState('');
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const [defaultAccountId, setDefaultAccountIdState] = useState<string | null>(null);
  const [defaultCurrency, setDefaultCurrencyState] = useState<string | null>(null);
  const [cashAccountId, setCashAccountIdState] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAtState] = useState<string | null>(null);

  async function reload() {
    const [creds, hosts, active, localUrls, localActive, name, geminiKey, acc, cur, cash, synced] = await Promise.all([
      readStoredCredentials(), readHosts(), getFf3ActiveHost(db), getLocalModelBaseUrls(db), getLocalModelActiveUrl(db),
      getLocalModelName(db), readGeminiKey(), getDefaultSourceAccountId(db), getDefaultCurrencyCode(db), getCashAccountId(db),
      getLastSyncedAt(db),
    ]);
    setSignedIn(!!creds);
    setFf3Hosts(hosts);
    setFf3ActiveHostState(active);
    setLocalModelUrls(localUrls);
    setLocalModelActiveUrlState(localActive);
    setLocalModelNameState(name ?? '');
    setHasGeminiKey(!!geminiKey);
    setDefaultAccountIdState(acc);
    setDefaultCurrencyState(cur);
    setCashAccountIdState(cash);
    setLastSyncedAtState(synced);
  }
  useEffect(() => { (async () => { await reload(); })(); }, [db]); // eslint-disable-line react-hooks/exhaustive-deps

  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(timer);
  }, [toast]);

  const [signInSheetOpen, setSignInSheetOpen] = useState(false);
  const [ff3AddressesOpen, setFf3AddressesOpen] = useState(false);
  const [localAddressesOpen, setLocalAddressesOpen] = useState(false);
  const [localModelSheetOpen, setLocalModelSheetOpen] = useState(false);
  const [geminiSheetOpen, setGeminiSheetOpen] = useState(false);
  const [accountSheetOpen, setAccountSheetOpen] = useState(false);
  const [currencySheetOpen, setCurrencySheetOpen] = useState(false);
  const [cashAccountSheetOpen, setCashAccountSheetOpen] = useState(false);

  const [host, setHost] = useState('');
  const [token, setToken] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [geminiKeyInput, setGeminiKeyInput] = useState('');
  const [saving, setSaving] = useState(false);

  /** Keeps a double-tap on any Save from writing the same secret or setting twice. */
  async function saveOnce(write: () => Promise<void>) {
    if (saving) return;
    setSaving(true);
    try {
      await write();
    } finally {
      setSaving(false);
    }
  }

  async function onSignIn() {
    if (signingIn) return;
    setSigningIn(true);
    try {
      // Signing in somewhere new while signed in is a switch of instance, same as signing out.
      const switching = signedIn && !isSameInstance(await readHosts(), host);
      if (switching) {
        const queued = await queuedOperationCount(db);
        if (queued > 0) {
          Alert.alert('Can\'t switch Firefly III yet', describeQueuedOperations(queued));
          return;
        }
      }
      const result = await signIn(host, token);
      if (result.ok) {
        if (switching) await clearInstanceData(db);
        setSignInSheetOpen(false);
        setToast('Connected to Firefly III');
        setHost('');
        setToken('');
        await reload();
        credentialsChanged();
      } else {
        Alert.alert('Sign-in failed', SIGN_IN_ERROR_MESSAGES[result.reason]);
      }
    } finally {
      setSigningIn(false);
    }
  }

  async function onSignOut() {
    const queued = await queuedOperationCount(db);
    if (queued > 0) {
      Alert.alert('Can\'t sign out yet', describeQueuedOperations(queued));
      return;
    }
    Alert.alert('Sign out?', 'Accounts and transactions synced from this Firefly III are removed from the device. Your drafts stay.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out', style: 'destructive', onPress: async () => {
          // Re-checked: a write can be queued while the dialog is open.
          const nowQueued = await queuedOperationCount(db);
          if (nowQueued > 0) {
            Alert.alert('Can\'t sign out yet', describeQueuedOperations(nowQueued));
            return;
          }
          await signOut();
          await clearInstanceData(db);
          await reload();
          credentialsChanged();
        },
      },
    ]);
  }

  function accountLabel(id: string | null): string {
    if (!id) return 'none';
    const active = assetAccounts.find((a) => a.id === id);
    if (active) return active.name;
    const inactive = allAssetAccounts.find((a) => a.id === id);
    return inactive ? `${inactive.name} (inactive)` : 'none';
  }

  const noAccountsHint = (
    <Text style={[t.type.body, { color: t.color.textMuted }]}>
      No asset accounts synced yet — connect Firefly III and pull to refresh.
    </Text>
  );

  const envelopeCount = assetAccounts.filter((a) => hasEnvelopeMarker(a.notes)).length;
  const version = Constants.expoConfig?.version ?? '0.1.0';

  return (
    <Screen>
      <AppBar title="Settings" />
      <ScrollView contentContainerStyle={{ paddingBottom: t.space.xxl }}>
        <SectionHeader title="Connection" />
        <Card style={{ marginHorizontal: t.space.lg }}>
          <Row
            first label="Firefly III" chevron
            value={signedIn ? 'connected' : 'not connected'} tone={signedIn ? 'default' : 'warn'}
            onPress={() => setSignInSheetOpen(true)}
          />
          <Row
            label="Addresses" chevron
            value={ff3Hosts.length > 0 ? `${shortLabel(ff3ActiveHost ?? ff3Hosts[0]!)}${ff3Hosts.length > 1 ? ` +${ff3Hosts.length - 1}` : ''}` : 'none'}
            onPress={() => setFf3AddressesOpen(true)}
          />
          {signedIn && <Row label="Sign out" tone="danger" onPress={onSignOut} />}
        </Card>

        <SectionHeader title="Receipts" />
        <Card style={{ marginHorizontal: t.space.lg }}>
          <Row first label="Local model" chevron value={localModelName || 'not set'} onPress={() => setLocalModelSheetOpen(true)} />
          <Row
            label="Addresses" chevron
            value={localModelUrls.length > 0 ? `${shortLabel(localModelActiveUrl ?? localModelUrls[0]!)}${localModelUrls.length > 1 ? ` +${localModelUrls.length - 1}` : ''}` : 'none'}
            onPress={() => setLocalAddressesOpen(true)}
          />
          <Row label="Gemini key" chevron value={hasGeminiKey ? 'set' : 'not set'} onPress={() => setGeminiSheetOpen(true)} />
        </Card>

        <SectionHeader title="Defaults" />
        <Card style={{ marginHorizontal: t.space.lg }}>
          <Row first label="Account" chevron value={accountLabel(defaultAccountId)} onPress={() => setAccountSheetOpen(true)} />
          <Row label="Currency" chevron value={defaultCurrency ?? 'none'} onPress={() => setCurrencySheetOpen(true)} />
          <Row label="Cash payments use" chevron value={accountLabel(cashAccountId)} onPress={() => setCashAccountSheetOpen(true)} />
        </Card>

        <SectionHeader title="Accounts" />
        <Card style={{ marginHorizontal: t.space.lg }}>
          <Row first label="Asset accounts" chevron value={`${assetAccounts.length} · ${envelopeCount} envelope${envelopeCount === 1 ? '' : 's'}`} onPress={() => router.push('/settings/accounts')} />
        </Card>

        <SectionHeader title="Data" />
        <Card style={{ marginHorizontal: t.space.lg }}>
          <Row first label="Aliases" chevron value={String((aliasRows ?? []).length)} onPress={() => router.push('/settings/aliases')} />
        </Card>

        <SectionHeader title="About" />
        <Card style={{ marginHorizontal: t.space.lg }}>
          <Row first label="Version" value={version} />
          <Row label="Last sync" value={relativeTime(lastSyncedAt)} />
          <Row label="Diagnostics" chevron onPress={() => router.push('/settings/logs')} />
        </Card>
      </ScrollView>

      <Toast message={toast} />

      <Sheet
        visible={signInSheetOpen}
        onClose={() => setSignInSheetOpen(false)}
        title="Firefly III"
        footer={<Button title={signingIn ? 'Connecting…' : 'Sign in'} onPress={onSignIn} disabled={signingIn} />}
      >
        <TextInput
          value={host} onChangeText={setHost} placeholder="https://firefly.example.com" autoCapitalize="none"
          placeholderTextColor={t.color.textFaint}
          style={{ borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.sm, padding: t.space.md, color: t.color.text }}
        />
        <TextInput
          value={token} onChangeText={setToken} placeholder="Personal access token" secureTextEntry autoCapitalize="none"
          placeholderTextColor={t.color.textFaint}
          style={{ borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.sm, padding: t.space.md, color: t.color.text, marginTop: t.space.sm }}
        />
      </Sheet>

      <AddressesSheet
        visible={ff3AddressesOpen}
        onClose={() => { setFf3AddressesOpen(false); reload(); }}
        title="Firefly III addresses"
        addresses={ff3Hosts}
        activeAddress={ff3ActiveHost}
        onSave={async (list) => { await writeHosts(list); setFf3Hosts(list); }}
        probe={async (address) => {
          const stored = await readStoredCredentials();
          if (!stored) return false;
          return (await probeAbout(address, stored.apiToken)).ok;
        }}
      />

      <AddressesSheet
        visible={localAddressesOpen}
        onClose={() => { setLocalAddressesOpen(false); reload(); }}
        title="Local model addresses"
        addresses={localModelUrls}
        activeAddress={localModelActiveUrl}
        onSave={async (list) => { await setLocalModelBaseUrls(db, list); setLocalModelUrls(list); }}
        probe={async (address) => {
          try {
            const response = await fetch(`${address.replace(/\/+$/, '')}/v1/models`, { method: 'GET' });
            return response.ok;
          } catch {
            return false;
          }
        }}
      />

      <Sheet
        visible={localModelSheetOpen}
        onClose={() => setLocalModelSheetOpen(false)}
        title="Local model"
        footer={(
          <Button
            title={saving ? 'Saving…' : 'Save'}
            disabled={saving}
            onPress={() => saveOnce(async () => { await setLocalModelName(db, localModelName); setLocalModelSheetOpen(false); })}
          />
        )}
      >
        <TextInput
          value={localModelName} onChangeText={setLocalModelNameState} placeholder="e.g. qwen3-vl-8b" autoCapitalize="none"
          placeholderTextColor={t.color.textFaint}
          style={{ borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.sm, padding: t.space.md, color: t.color.text }}
        />
      </Sheet>

      <Sheet
        visible={geminiSheetOpen}
        onClose={() => setGeminiSheetOpen(false)}
        title="Gemini API key"
        footer={(
          <Button
            title={saving ? 'Saving…' : 'Save'}
            disabled={saving || !geminiKeyInput.trim()}
            onPress={() => saveOnce(async () => {
              await saveGeminiKey(geminiKeyInput);
              setHasGeminiKey(true);
              setGeminiKeyInput('');
              setGeminiSheetOpen(false);
            })}
          />
        )}
      >
        <TextInput
          value={geminiKeyInput} onChangeText={setGeminiKeyInput} placeholder="API key" secureTextEntry autoCapitalize="none"
          placeholderTextColor={t.color.textFaint}
          style={{ borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.sm, padding: t.space.md, color: t.color.text }}
        />
      </Sheet>

      <Sheet visible={accountSheetOpen} onClose={() => setAccountSheetOpen(false)} title="Default account">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
          {assetAccounts.map((a) => (
            <Chip key={a.id} label={a.name} selected={a.id === defaultAccountId} onPress={async () => { await setDefaultSourceAccountId(db, a.id); setDefaultAccountIdState(a.id); setAccountSheetOpen(false); }} />
          ))}
          {assetAccounts.length === 0 && noAccountsHint}
        </View>
      </Sheet>

      <Sheet visible={currencySheetOpen} onClose={() => setCurrencySheetOpen(false)} title="Default currency">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
          {(currencies ?? []).map((c) => (
            <Chip key={c.code} label={c.code} selected={c.code === defaultCurrency} onPress={async () => { await setDefaultCurrencyCode(db, c.code); setDefaultCurrencyState(c.code); setCurrencySheetOpen(false); }} />
          ))}
        </View>
      </Sheet>

      <Sheet visible={cashAccountSheetOpen} onClose={() => setCashAccountSheetOpen(false)} title="Cash payments use">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
          {assetAccounts.map((a) => (
            <Chip key={a.id} label={a.name} selected={a.id === cashAccountId} onPress={async () => { await setCashAccountId(db, a.id); setCashAccountIdState(a.id); setCashAccountSheetOpen(false); }} />
          ))}
          {assetAccounts.length === 0 && noAccountsHint}
        </View>
      </Sheet>
    </Screen>
  );
}
