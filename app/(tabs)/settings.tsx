// Settings (design §6.6) — grouped Card/Row layout, every › opens a Sheet. No nested FlatLists.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { eq } from 'drizzle-orm';
import { Alert, ScrollView, Text } from 'react-native';
import { router } from 'expo-router';
import { useLiveQuery } from '../../src/db/useLiveQuery';
import Constants from 'expo-constants';
import { useDb } from '../../src/providers/DbProvider';
import { useTheme } from '../../src/ui/theme';
import { Screen, AppBar, SectionHeader, Card, Row, Button, Sheet, Toast } from '../../src/ui/components';
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
import { PAYEE } from '../../src/lookup/aliases';
import { clearInstanceData, describeQueuedOperations, isSameInstance, queuedOperationCount } from '../../src/sync/instanceData';
import {
  getLocalModelBaseUrls, setLocalModelBaseUrls, getLocalModelActiveUrl,
  getLocalModelName, setLocalModelName,
  getDefaultSourceAccountId, setDefaultSourceAccountId,
  getDefaultCurrencyCode, setDefaultCurrencyCode,
  getCashAccountId, setCashAccountId,
  getFf3ActiveHost, getLastSyncedAt,
  getLocale, setLocale,
} from '../../src/settings/appSettings';
import type { AppLocale } from '../../src/i18n';
import { TextField } from '../../src/ui/TextField';
import { PickerSheet } from '../../src/ui/PickerSheet';
import { useAction } from '../../src/ui/useAction';
import { pickableCurrencies, primaryCurrencyCode } from '../../src/ui/currencies';
import { confirmDestructive } from '../../src/ui/confirm';
import { useToast } from '../../src/ui/useToast';
import { probeLocalModel } from '../../src/receipt/providers/local';

const SIGN_IN_ERROR_KEYS: Record<AuthErrorReason, string> = {
  invalid_host: 'settings.signInErrors.invalidHost',
  invalid_api_key: 'settings.signInErrors.invalidApiKey',
  unexpected_status: 'settings.signInErrors.unexpectedStatus',
  not_a_firefly_instance: 'settings.signInErrors.notAFireflyInstance',
  api_version_too_low: 'settings.signInErrors.apiVersionTooLow',
};

const LANGUAGE_OPTIONS: { value: AppLocale; labelKey: string }[] = [
  { value: 'system', labelKey: 'settings.languageSystem' },
  { value: 'en', labelKey: 'settings.languageEnglish' },
  { value: 'uk-UA', labelKey: 'settings.languageUkrainian' },
];

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
  const { t: tr } = useTranslation();
  const act = useAction();

  const allAssetAccounts = useAssetAccounts({ includeInactive: true }) ?? [];
  const assetAccounts = useAssetAccounts() ?? [];
  const { data: currencies } = useLiveQuery(db.select().from(referenceCurrencies));
  const { data: aliasRows } = useLiveQuery(db.select().from(aliasesTable).where(eq(aliasesTable.kind, PAYEE)));

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
  const [locale, setLocaleState] = useState<AppLocale>('system');

  async function reload() {
    const [creds, hosts, active, localUrls, localActive, name, geminiKey, acc, cur, cash, synced, lang] = await Promise.all([
      readStoredCredentials(), readHosts(), getFf3ActiveHost(db), getLocalModelBaseUrls(db), getLocalModelActiveUrl(db),
      getLocalModelName(db), readGeminiKey(), getDefaultSourceAccountId(db), getDefaultCurrencyCode(db), getCashAccountId(db),
      getLastSyncedAt(db), getLocale(db),
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
    setLocaleState(lang);
  }
  useEffect(() => { (async () => { await reload(); })(); }, [db]); // eslint-disable-line react-hooks/exhaustive-deps

  const [toast, setToast] = useToast();

  const [signInSheetOpen, setSignInSheetOpen] = useState(false);
  const [ff3AddressesOpen, setFf3AddressesOpen] = useState(false);
  const [localAddressesOpen, setLocalAddressesOpen] = useState(false);
  const [localModelSheetOpen, setLocalModelSheetOpen] = useState(false);
  const [geminiSheetOpen, setGeminiSheetOpen] = useState(false);
  const [accountSheetOpen, setAccountSheetOpen] = useState(false);
  const [currencySheetOpen, setCurrencySheetOpen] = useState(false);
  const [cashAccountSheetOpen, setCashAccountSheetOpen] = useState(false);
  const [languageSheetOpen, setLanguageSheetOpen] = useState(false);

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

  const onSignIn = act(tr('settings.signIn'), async () => {
    if (signingIn) return;
    setSigningIn(true);
    try {
      // Signing in somewhere new while signed in is a switch of instance, same as signing out.
      const switching = signedIn && !isSameInstance(await readHosts(), host);
      if (switching) {
        const queued = await queuedOperationCount(db);
        if (queued > 0) {
          Alert.alert(tr('settings.cantSwitchYet'), describeQueuedOperations(queued));
          return;
        }
      }
      const result = await signIn(host, token);
      if (result.ok) {
        if (switching) await clearInstanceData(db);
        setSignInSheetOpen(false);
        setToast(tr('settings.connected'));
        setHost('');
        setToken('');
        await reload();
        credentialsChanged();
      } else {
        Alert.alert(tr('settings.signInFailed'), tr(SIGN_IN_ERROR_KEYS[result.reason]));
      }
    } finally {
      setSigningIn(false);
    }
  });

  const onSignOut = act(tr('settings.signOut'), async () => {
    const queued = await queuedOperationCount(db);
    if (queued > 0) {
      Alert.alert(tr('settings.cantSignOutYet'), describeQueuedOperations(queued));
      return;
    }
    if (!await confirmDestructive(tr('settings.signOutTitle'), tr('settings.signOut'), tr('settings.signOutBody'))) return;
    // Re-checked: a write can be queued while the dialog is open.
    const nowQueued = await queuedOperationCount(db);
    if (nowQueued > 0) {
      Alert.alert(tr('settings.cantSignOutYet'), describeQueuedOperations(nowQueued));
      return;
    }
    await signOut();
    await clearInstanceData(db);
    await reload();
    credentialsChanged();
  });

  function accountLabel(id: string | null): string {
    if (!id) return tr('settings.none');
    const active = assetAccounts.find((a) => a.id === id);
    if (active) return active.name;
    const inactive = allAssetAccounts.find((a) => a.id === id);
    return inactive ? tr('settings.inactiveAccount', { name: inactive.name }) : tr('settings.none');
  }

  const noAccountsHint = (
    <Text style={[t.type.body, { color: t.color.textMuted }]}>
      {tr('settings.noAccountsHint')}
    </Text>
  );

  const envelopeCount = assetAccounts.filter((a) => hasEnvelopeMarker(a.notes)).length;
  const version = Constants.expoConfig?.version ?? '0.1.0';

  return (
    <Screen>
      <AppBar title={tr('settings.title')} />
      <ScrollView contentContainerStyle={{ paddingBottom: t.space.xxl }}>
        <SectionHeader title={tr('settings.sectionConnection')} />
        <Card style={{ marginHorizontal: t.space.lg }}>
          <Row
            first label="Firefly III" chevron
            value={signedIn ? tr('settings.connectedValue') : tr('settings.notConnected')} tone={signedIn ? 'default' : 'warn'}
            onPress={() => setSignInSheetOpen(true)}
          />
          <Row
            label={tr('settings.addresses')} chevron
            value={ff3Hosts.length > 0 ? `${shortLabel(ff3ActiveHost ?? ff3Hosts[0]!)}${ff3Hosts.length > 1 ? ` +${ff3Hosts.length - 1}` : ''}` : tr('settings.none')}
            onPress={() => setFf3AddressesOpen(true)}
          />
          {signedIn && <Row label={tr('settings.signOut')} icon="log-out-outline" tone="danger" onPress={onSignOut} />}
        </Card>

        <SectionHeader title={tr('settings.sectionReceipts')} />
        <Card style={{ marginHorizontal: t.space.lg }}>
          <Row first label={tr('sync.providerLocal')} chevron value={localModelName || tr('settings.notSet')} onPress={() => setLocalModelSheetOpen(true)} />
          <Row
            label={tr('settings.addresses')} chevron
            value={localModelUrls.length > 0 ? `${shortLabel(localModelActiveUrl ?? localModelUrls[0]!)}${localModelUrls.length > 1 ? ` +${localModelUrls.length - 1}` : ''}` : tr('settings.none')}
            onPress={() => setLocalAddressesOpen(true)}
          />
          <Row label={tr('settings.geminiKey')} chevron value={hasGeminiKey ? tr('settings.set') : tr('settings.notSet')} onPress={() => setGeminiSheetOpen(true)} />
        </Card>

        <SectionHeader title={tr('settings.sectionDefaults')} />
        <Card style={{ marginHorizontal: t.space.lg }}>
          <Row first label={tr('settings.account')} chevron value={accountLabel(defaultAccountId)} onPress={() => setAccountSheetOpen(true)} />
          <Row label={tr('fields.currency')} chevron value={defaultCurrency ?? primaryCurrencyCode(currencies) ?? tr('settings.none')} onPress={() => setCurrencySheetOpen(true)} />
          <Row label={tr('settings.cashPaymentsUse')} chevron value={accountLabel(cashAccountId)} onPress={() => setCashAccountSheetOpen(true)} />
        </Card>

        <SectionHeader title={tr('accounts.title')} />
        <Card style={{ marginHorizontal: t.space.lg }}>
          <Row first label={tr('settings.assetAccounts')} chevron value={`${assetAccounts.length} · ${tr('settings.envelopeCount', { count: envelopeCount })}`} onPress={() => router.push('/settings/accounts')} />
        </Card>

        <SectionHeader title={tr('settings.sectionData')} />
        <Card style={{ marginHorizontal: t.space.lg }}>
          <Row first label={tr('aliases.title')} chevron value={String((aliasRows ?? []).length)} onPress={() => router.push('/settings/aliases')} />
        </Card>

        <SectionHeader title={tr('settings.sectionLanguage')} />
        <Card style={{ marginHorizontal: t.space.lg }}>
          <Row
            first label={tr('settings.language')} chevron
            value={tr(LANGUAGE_OPTIONS.find((o) => o.value === locale)!.labelKey)}
            onPress={() => setLanguageSheetOpen(true)}
          />
        </Card>

        <SectionHeader title={tr('settings.sectionAbout')} />
        <Card style={{ marginHorizontal: t.space.lg }}>
          <Row first label={tr('settings.version')} value={version} />
          <Row label={tr('settings.lastSync')} value={relativeTime(lastSyncedAt)} />
          <Row label={tr('logs.title')} icon="document-text-outline" onPress={() => router.push('/settings/logs')} />
        </Card>
      </ScrollView>

      <Toast message={toast} />

      <Sheet
        visible={signInSheetOpen}
        onClose={() => setSignInSheetOpen(false)}
        title="Firefly III"
        footer={<Button title={signingIn ? tr('settings.connecting') : tr('settings.signIn')} onPress={onSignIn} disabled={signingIn} />}
      >
        <TextField
          value={host} onChangeText={setHost} placeholder="https://firefly.example.com" autoCapitalize="none"
        />
        <TextField
          value={token} onChangeText={setToken} placeholder={tr('settings.tokenPlaceholder')} secureTextEntry autoCapitalize="none"
          style={{ marginTop: t.space.sm }}
        />
      </Sheet>

      <AddressesSheet
        visible={ff3AddressesOpen}
        onClose={() => { setFf3AddressesOpen(false); reload(); }}
        title={tr('settings.ff3Addresses')}
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
        title={tr('settings.localModelAddresses')}
        addresses={localModelUrls}
        activeAddress={localModelActiveUrl}
        onSave={async (list) => { await setLocalModelBaseUrls(db, list); setLocalModelUrls(list); }}
        probe={probeLocalModel}
      />

      <Sheet
        visible={localModelSheetOpen}
        onClose={() => setLocalModelSheetOpen(false)}
        title={tr('sync.providerLocal')}
        footer={(
          <Button
            title={saving ? tr('common.saving') : tr('common.save')}
            disabled={saving}
            onPress={() => saveOnce(async () => { await setLocalModelName(db, localModelName); setLocalModelSheetOpen(false); })}
          />
        )}
      >
        <TextField
          value={localModelName} onChangeText={setLocalModelNameState} placeholder={tr('settings.localModelPlaceholder')} autoCapitalize="none"
        />
      </Sheet>

      <Sheet
        visible={geminiSheetOpen}
        onClose={() => setGeminiSheetOpen(false)}
        title={tr('settings.geminiApiKey')}
        footer={(
          <Button
            title={saving ? tr('common.saving') : tr('common.save')}
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
        <Text style={[t.type.label, { color: t.color.textMuted }]}>{tr('settings.geminiPrivacy')}</Text>
        <TextField
          value={geminiKeyInput} onChangeText={setGeminiKeyInput} placeholder={tr('settings.apiKeyPlaceholder')} secureTextEntry autoCapitalize="none"
        />
      </Sheet>

      <PickerSheet
        visible={accountSheetOpen} onClose={() => setAccountSheetOpen(false)} title={tr('settings.defaultAccount')}
        options={assetAccounts.map((a) => ({ key: a.id, label: a.name }))} selected={defaultAccountId} empty={noAccountsHint}
        onSelect={act(tr('settings.defaultAccount'), async (id: string | null) => { if (!id) return; await setDefaultSourceAccountId(db, id); setDefaultAccountIdState(id); })}
      />

      <PickerSheet
        visible={currencySheetOpen} onClose={() => setCurrencySheetOpen(false)} title={tr('settings.defaultCurrency')}
        options={pickableCurrencies(currencies, defaultCurrency).map((c) => ({ key: c.code, label: c.code }))} selected={defaultCurrency ?? primaryCurrencyCode(currencies)}
        onSelect={act(tr('settings.defaultCurrency'), async (code: string | null) => { if (!code) return; await setDefaultCurrencyCode(db, code); setDefaultCurrencyState(code); })}
      />

      <PickerSheet
        visible={cashAccountSheetOpen} onClose={() => setCashAccountSheetOpen(false)} title={tr('settings.cashPaymentsUse')}
        options={assetAccounts.map((a) => ({ key: a.id, label: a.name }))} selected={cashAccountId} empty={noAccountsHint}
        onSelect={act(tr('settings.cashPaymentsUse'), async (id: string | null) => { if (!id) return; await setCashAccountId(db, id); setCashAccountIdState(id); })}
      />

      <PickerSheet
        visible={languageSheetOpen} onClose={() => setLanguageSheetOpen(false)} title={tr('settings.language')}
        header={<Text style={[t.type.label, { color: t.color.textMuted }]}>{tr('settings.languageHint')}</Text>}
        options={LANGUAGE_OPTIONS.map((o) => ({ key: o.value, label: tr(o.labelKey) }))} selected={locale}
        onSelect={act(tr('settings.language'), async (value: string | null) => { const next = (value ?? 'system') as AppLocale; await setLocale(db, next); setLocaleState(next); })}
      />
    </Screen>
  );
}
