// Settings (design §6.6) — grouped Card/Row layout, every › opens a Sheet. No nested FlatLists.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { eq } from 'drizzle-orm';
import { Alert, ScrollView, Text } from 'react-native';
import { router } from 'expo-router';
import { useLiveQuery } from '../../src/db/useLiveQuery';
import { useCurrencies } from '../../src/db/useReferenceData';
import Constants from 'expo-constants';
import { useDb } from '../../src/providers/DbProvider';
import { useTheme } from '../../src/ui/theme';
import {
  Screen,
  AppBar,
  SectionHeader,
  Card,
  Row,
  Button,
  Sheet,
  Toast,
} from '../../src/ui/components';
import { AddressesSheet } from '../../src/ui/AddressesSheet';
import { relativeTime } from '../../src/ui/relativeTime';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { loadSettings, SETTINGS_QUERY_KEY } from '../../src/settings/loadSettings';
import { signIn, signOut, readStoredCredentials, probeAbout } from '../../src/api/ff3/auth';
import type { AuthErrorReason } from '../../src/api/ff3/types';
import { readHosts, writeHosts } from '../../src/api/ff3/hosts';
import { saveGeminiKey } from '../../src/settings/secrets';
import { aliases as aliasesTable } from '../../src/db/schema';
import { useAssetAccounts } from '../../src/accounts/useAssetAccounts';
import { hasEnvelopeMarker } from '../../src/accounts/envelopeMarker';
import { useSync } from '../../src/sync/useSync';
import { PAYEE } from '../../src/lookup/aliases';
import {
  clearInstanceData,
  describeQueuedOperations,
  isSameInstance,
  queuedOperationCount,
} from '../../src/sync/instanceData';
import {
  setLocalModelBaseUrls,
  setLocalModelName,
  setDefaultSourceAccountId,
  setDefaultCurrencyCode,
  setCashAccountId,
  setLocale,
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
  const currencies = useCurrencies();
  const { data: aliasRows } = useLiveQuery(
    db.select().from(aliasesTable).where(eq(aliasesTable.kind, PAYEE)),
  );

  const { data: settings } = useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: () => loadSettings(db),
  });
  const queryClient = useQueryClient();
  /** Re-reads every setting. Called after a write and when a sheet that wrote one closes. */
  const reload = () => queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });

  const signedIn = settings?.signedIn ?? false;
  const ff3Hosts = settings?.ff3Hosts ?? [];
  const ff3ActiveHost = settings?.ff3ActiveHost ?? null;
  const localModelUrls = settings?.localModelUrls ?? [];
  const localModelActiveUrl = settings?.localModelActiveUrl ?? null;
  const hasGeminiKey = settings?.hasGeminiKey ?? false;
  const defaultAccountId = settings?.defaultAccountId ?? null;
  const defaultCurrency = settings?.defaultCurrency ?? null;
  const cashAccountId = settings?.cashAccountId ?? null;
  const lastSyncedAt = settings?.lastSyncedAt ?? null;
  const locale: AppLocale = settings?.locale ?? 'system';
  // The one setting that is typed before it's saved, so it needs a draft of its own.
  const [localModelNameInput, setLocalModelNameInput] = useState<string | null>(null);
  const localModelName = localModelNameInput ?? settings?.localModelName ?? '';

  const [toast, setToast] = useToast();

  // Only one sheet is ever open, so it is one state rather than a boolean each.
  const [sheet, setSheet] = useState<
    | 'signIn'
    | 'ff3Addresses'
    | 'localAddresses'
    | 'localModel'
    | 'gemini'
    | 'account'
    | 'currency'
    | 'cashAccount'
    | 'language'
    | null
  >(null);

  const [host, setHost] = useState('');
  const [token, setToken] = useState('');
  const [geminiKeyInput, setGeminiKeyInput] = useState('');

  /** Keeps a double-tap on any Save from writing the same secret or setting twice. */
  const saveOnce = act(tr('common.save'), (write: () => Promise<void>) => write());
  const saving = act.pending(tr('common.save'));
  const signingIn = act.pending(tr('settings.signIn'));

  const onSignIn = act(tr('settings.signIn'), async () => {
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
      setSheet(null);
      setToast(tr('settings.connected'));
      setHost('');
      setToken('');
      await reload();
      credentialsChanged();
    } else {
      Alert.alert(tr('settings.signInFailed'), tr(SIGN_IN_ERROR_KEYS[result.reason]));
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
    <Text style={[t.type.body, { color: t.color.textMuted }]}>{tr('settings.noAccountsHint')}</Text>
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
            first
            label="Firefly III"
            chevron
            value={signedIn ? tr('settings.connectedValue') : tr('settings.notConnected')}
            tone={signedIn ? 'default' : 'warn'}
            onPress={() => setSheet('signIn')}
          />
          <Row
            label={tr('settings.addresses')}
            chevron
            value={
              ff3Hosts.length > 0
                ? `${shortLabel(ff3ActiveHost ?? ff3Hosts[0]!)}${ff3Hosts.length > 1 ? ` +${ff3Hosts.length - 1}` : ''}`
                : tr('settings.none')
            }
            onPress={() => setSheet('ff3Addresses')}
          />
          {/* The row is kept while the settings load, so the section is its final height on the
              first frame — it used to appear once "signed in" was known and shift what's below. */}
          {(signedIn || !settings) && (
            <Row
              label={tr('settings.signOut')}
              icon="log-out-outline"
              tone="danger"
              onPress={settings ? onSignOut : undefined}
            />
          )}
        </Card>

        <SectionHeader title={tr('settings.sectionReceipts')} />
        <Card style={{ marginHorizontal: t.space.lg }}>
          <Row
            first
            label={tr('sync.providerLocal')}
            chevron
            value={localModelName || tr('settings.notSet')}
            onPress={() => setSheet('localModel')}
          />
          <Row
            label={tr('settings.addresses')}
            chevron
            value={
              localModelUrls.length > 0
                ? `${shortLabel(localModelActiveUrl ?? localModelUrls[0]!)}${localModelUrls.length > 1 ? ` +${localModelUrls.length - 1}` : ''}`
                : tr('settings.none')
            }
            onPress={() => setSheet('localAddresses')}
          />
          <Row
            label={tr('settings.geminiKey')}
            chevron
            value={hasGeminiKey ? tr('settings.set') : tr('settings.notSet')}
            onPress={() => setSheet('gemini')}
          />
        </Card>

        <SectionHeader title={tr('settings.sectionDefaults')} />
        <Card style={{ marginHorizontal: t.space.lg }}>
          <Row
            first
            label={tr('settings.account')}
            chevron
            value={accountLabel(defaultAccountId)}
            onPress={() => setSheet('account')}
          />
          <Row
            label={tr('fields.currency')}
            chevron
            value={defaultCurrency ?? primaryCurrencyCode(currencies) ?? tr('settings.none')}
            onPress={() => setSheet('currency')}
          />
          <Row
            label={tr('settings.cashPaymentsUse')}
            chevron
            value={accountLabel(cashAccountId)}
            onPress={() => setSheet('cashAccount')}
          />
        </Card>

        <SectionHeader title={tr('accounts.title')} />
        <Card style={{ marginHorizontal: t.space.lg }}>
          <Row
            first
            label={tr('settings.assetAccounts')}
            chevron
            value={`${assetAccounts.length} · ${tr('settings.envelopeCount', { count: envelopeCount })}`}
            onPress={() => router.push('/settings/accounts')}
          />
        </Card>

        <SectionHeader title={tr('settings.sectionData')} />
        <Card style={{ marginHorizontal: t.space.lg }}>
          <Row
            first
            label={tr('aliases.title')}
            chevron
            value={String((aliasRows ?? []).length)}
            onPress={() => router.push('/settings/aliases')}
          />
        </Card>

        <SectionHeader title={tr('settings.sectionLanguage')} />
        <Card style={{ marginHorizontal: t.space.lg }}>
          <Row
            first
            label={tr('settings.language')}
            chevron
            value={tr(LANGUAGE_OPTIONS.find((o) => o.value === locale)!.labelKey)}
            onPress={() => setSheet('language')}
          />
        </Card>

        <SectionHeader title={tr('settings.sectionAbout')} />
        <Card style={{ marginHorizontal: t.space.lg }}>
          <Row first label={tr('settings.version')} value={version} />
          <Row label={tr('settings.lastSync')} value={relativeTime(lastSyncedAt)} />
          <Row
            label={tr('logs.title')}
            icon="document-text-outline"
            onPress={() => router.push('/settings/logs')}
          />
        </Card>
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

      <AddressesSheet
        visible={sheet === 'localAddresses'}
        onClose={() => {
          setSheet(null);
          reload();
        }}
        title={tr('settings.localModelAddresses')}
        addresses={localModelUrls}
        activeAddress={localModelActiveUrl}
        onSave={async (list) => {
          await setLocalModelBaseUrls(db, list);
          await reload();
        }}
        probe={probeLocalModel}
      />

      <Sheet
        visible={sheet === 'localModel'}
        onClose={() => {
          setSheet(null);
          setLocalModelNameInput(null); // drop an unsaved edit, so the sheet reopens on the stored name
        }}
        title={tr('sync.providerLocal')}
        footer={
          <Button
            title={saving ? tr('common.saving') : tr('common.save')}
            disabled={saving}
            onPress={() =>
              saveOnce(async () => {
                await setLocalModelName(db, localModelName);
                setLocalModelNameInput(null);
                await reload();
                setSheet(null);
              })
            }
          />
        }
      >
        <TextField
          value={localModelName}
          onChangeText={setLocalModelNameInput}
          placeholder={tr('settings.localModelPlaceholder')}
          autoCapitalize="none"
        />
      </Sheet>

      <Sheet
        visible={sheet === 'gemini'}
        onClose={() => setSheet(null)}
        title={tr('settings.geminiApiKey')}
        footer={
          <Button
            title={saving ? tr('common.saving') : tr('common.save')}
            disabled={saving || !geminiKeyInput.trim()}
            onPress={() =>
              saveOnce(async () => {
                await saveGeminiKey(geminiKeyInput);
                await reload();
                setGeminiKeyInput('');
                setSheet(null);
              })
            }
          />
        }
      >
        <Text style={[t.type.label, { color: t.color.textMuted }]}>
          {tr('settings.geminiPrivacy')}
        </Text>
        <TextField
          value={geminiKeyInput}
          onChangeText={setGeminiKeyInput}
          placeholder={tr('settings.apiKeyPlaceholder')}
          secureTextEntry
          autoCapitalize="none"
        />
      </Sheet>

      <PickerSheet
        visible={sheet === 'account'}
        onClose={() => setSheet(null)}
        title={tr('settings.defaultAccount')}
        options={assetAccounts.map((a) => ({ key: a.id, label: a.name }))}
        selected={defaultAccountId}
        empty={noAccountsHint}
        onSelect={act(tr('settings.defaultAccount'), async (id: string | null) => {
          if (!id) return;
          await setDefaultSourceAccountId(db, id);
          await reload();
        })}
      />

      <PickerSheet
        visible={sheet === 'currency'}
        onClose={() => setSheet(null)}
        title={tr('settings.defaultCurrency')}
        options={pickableCurrencies(currencies, defaultCurrency).map((c) => ({
          key: c.code,
          label: c.code,
        }))}
        selected={defaultCurrency ?? primaryCurrencyCode(currencies)}
        onSelect={act(tr('settings.defaultCurrency'), async (code: string | null) => {
          if (!code) return;
          await setDefaultCurrencyCode(db, code);
          await reload();
        })}
      />

      <PickerSheet
        visible={sheet === 'cashAccount'}
        onClose={() => setSheet(null)}
        title={tr('settings.cashPaymentsUse')}
        options={assetAccounts.map((a) => ({ key: a.id, label: a.name }))}
        selected={cashAccountId}
        empty={noAccountsHint}
        onSelect={act(tr('settings.cashPaymentsUse'), async (id: string | null) => {
          if (!id) return;
          await setCashAccountId(db, id);
          await reload();
        })}
      />

      <PickerSheet
        visible={sheet === 'language'}
        onClose={() => setSheet(null)}
        title={tr('settings.language')}
        header={
          <Text style={[t.type.label, { color: t.color.textMuted }]}>
            {tr('settings.languageHint')}
          </Text>
        }
        options={LANGUAGE_OPTIONS.map((o) => ({ key: o.value, label: tr(o.labelKey) }))}
        selected={locale}
        onSelect={act(tr('settings.language'), async (value: string | null) => {
          const next = (value ?? 'system') as AppLocale;
          await setLocale(db, next);
          await reload();
        })}
      />
    </Screen>
  );
}
