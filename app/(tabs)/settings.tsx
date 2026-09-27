// Settings (design §6.6) — grouped Card/Row layout, every › opens a Sheet. No nested FlatLists.
import { useEffect, useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import Constants from 'expo-constants';
import { useDb } from '../../src/providers/DbProvider';
import { useTheme } from '../../src/ui/theme';
import { Screen, AppBar, SectionHeader, Card, Row, Chip, Button, Sheet } from '../../src/ui/components';
import { AddressesSheet } from '../../src/ui/AddressesSheet';
import { relativeTime } from '../../src/ui/relativeTime';
import { signIn, signOut, readStoredCredentials, probeAbout } from '../../src/api/ff3/auth';
import { readHosts, writeHosts } from '../../src/api/ff3/hosts';
import { saveGeminiKey, readGeminiKey } from '../../src/settings/secrets';
import { referenceAccounts, referenceCurrencies, aliases as aliasesTable } from '../../src/db/schema';
import { hasEnvelopeMarker } from '../../src/accounts/envelopeMarker';
import {
  getLocalModelBaseUrls, setLocalModelBaseUrls, getLocalModelActiveUrl,
  getLocalModelName, setLocalModelName,
  getDefaultSourceAccountId, setDefaultSourceAccountId,
  getDefaultCurrencyCode, setDefaultCurrencyCode,
  getCashAccountId, setCashAccountId,
  getFf3ActiveHost, getLastSyncedAt,
} from '../../src/settings/appSettings';

function shortLabel(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export default function SettingsScreen() {
  const db = useDb();
  const t = useTheme();

  const { data: accounts } = useLiveQuery(db.select().from(referenceAccounts));
  const { data: currencies } = useLiveQuery(db.select().from(referenceCurrencies));
  const { data: aliasRows } = useLiveQuery(db.select().from(aliasesTable));
  const assetAccounts = (accounts ?? []).filter((a) => a.type === 'asset');

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

  async function onSignIn() {
    if (signingIn) return;
    setSigningIn(true);
    try {
      const result = await signIn(host, token);
      if (result.ok) {
        setSignInSheetOpen(false);
        setToast('Connected to Firefly III');
        setHost('');
        setToken('');
        await reload();
      } else {
        Alert.alert('Sign-in failed', result.reason);
      }
    } finally {
      setSigningIn(false);
    }
  }

  function onSignOut() {
    Alert.alert('Sign out?', 'You will need to sign in again to sync.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: async () => { await signOut(); await reload(); } },
    ]);
  }

  const envelopeCount = assetAccounts.filter((a) => hasEnvelopeMarker(a.notes)).length;
  const version = Constants.expoConfig?.version ?? '0.1.0';

  return (
    <Screen>
      <AppBar title="Settings" />
      <View style={{ paddingBottom: t.space.xxl }}>
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
          <Row first label="Account" chevron value={assetAccounts.find((a) => a.id === defaultAccountId)?.name ?? 'none'} onPress={() => setAccountSheetOpen(true)} />
          <Row label="Currency" chevron value={defaultCurrency ?? 'none'} onPress={() => setCurrencySheetOpen(true)} />
          <Row label="Cash payments use" chevron value={assetAccounts.find((a) => a.id === cashAccountId)?.name ?? 'none'} onPress={() => setCashAccountSheetOpen(true)} />
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
        </Card>
      </View>

      {!!toast && (
        <View pointerEvents="none" style={{ position: 'absolute', top: 8, left: t.space.lg, right: t.space.lg, alignItems: 'center' }}>
          <View style={{ backgroundColor: t.color.text, borderRadius: t.radius.pill, paddingHorizontal: t.space.lg, paddingVertical: t.space.sm }}>
            <Text style={[t.type.label, { color: t.color.surface }]}>{toast}</Text>
          </View>
        </View>
      )}

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
        footer={<Button title="Save" onPress={async () => { await setLocalModelName(db, localModelName); setLocalModelSheetOpen(false); }} />}
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
        footer={<Button title="Save" onPress={async () => { await saveGeminiKey(geminiKeyInput); setHasGeminiKey(true); setGeminiKeyInput(''); setGeminiSheetOpen(false); }} />}
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
        </View>
      </Sheet>
    </Screen>
  );
}
