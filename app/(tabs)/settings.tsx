// Settings (design §6.6, Settings.dc.html) — grouped Cards of ListRows. Each group is one flush Card;
// a row either opens a page (Firefly III, Receipts, Reminders, Accounts, About…), a Choose sheet
// (defaults, language) or flips a switch. No nested FlatLists.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, Text } from 'react-native';
import { router } from 'expo-router';
import { useCurrencies } from '../../src/db/useReferenceData';
import Constants from 'expo-constants';
import { useDb } from '../../src/providers/DbProvider';
import { useTheme } from '../../src/ui/theme';
import { Card, ListRow, Screen, SectionHeader, SwitchRow, TabHeader, Tile } from '../../src/ui/kit';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { loadSettings, SETTINGS_QUERY_KEY } from '../../src/settings/loadSettings';
import { useAssetAccounts } from '../../src/accounts/useAssetAccounts';
import { hasEnvelopeMarker } from '../../src/accounts/envelopeMarker';
import { useLiveQuery } from '../../src/db/useLiveQuery';
// eslint-disable-next-line no-restricted-imports -- kit-exception: pre-Kit-V2 (MKL-87)
import { payeeAliases } from '../../src/db/schema';
import {
  setDefaultSourceAccountId,
  setDefaultCurrencyCode,
  setCashAccountId,
  setLocale,
  setRecordLocation,
  setAppLockEnabled,
  getDemoMode,
} from '../../src/settings/appSettings';
import i18n, { type AppLocale } from '../../src/i18n';
import { authenticate, canUseAppLock } from '../../src/lock/appLock';
import { PickerSheet } from '../../src/ui/PickerSheet';
import { AccountPickerSheet } from '../../src/ui/AccountPickerSheet';
import { forgetPosition, startPositionRequest } from '../../src/capture/position';
import { useAction } from '../../src/ui/useAction';
import { pickableCurrencies, primaryCurrencyCode } from '../../src/ui/currencies';
import { useFlags } from '../../src/flags/useFlag';

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

/** "2 days before, and on the day" — or "Only on the day" for no lead at all. */
function reminderLeadName(days: number): string {
  return days === 0
    ? i18n.t('planned.reminderLeadNone')
    : i18n.t('planned.reminderLead', { count: days });
}

export default function SettingsScreen() {
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const act = useAction();
  const flags = useFlags();

  const allAssetAccounts = useAssetAccounts({ includeInactive: true }) ?? [];
  const assetAccounts = useAssetAccounts() ?? [];
  const currencies = useCurrencies();
  const { data: aliasRows } = useLiveQuery(db.select().from(payeeAliases));
  const aliasesCount = aliasRows?.length ?? 0;

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
  const ff3ActiveHost = settings?.ff3ActiveHost ?? null;
  const localModelName = settings?.localModelName ?? '';
  const localModelUrls = settings?.localModelUrls ?? [];
  const hasGeminiKey = settings?.hasGeminiKey ?? false;
  const defaultAccountId = settings?.defaultAccountId ?? null;
  const defaultCurrency = settings?.defaultCurrency ?? null;
  const cashAccountId = settings?.cashAccountId ?? null;
  const locale: AppLocale = settings?.locale ?? 'system';
  const recordLocation = settings?.recordLocation ?? true;
  const plannedNotifications = settings?.plannedNotifications ?? false;
  const plannedReminderLead = settings?.plannedReminderLead ?? 2;
  const appLock = settings?.appLock ?? false;

  // Only one sheet is ever open, so it is one state rather than a boolean each.
  const [sheet, setSheet] = useState<'account' | 'currency' | 'cashAccount' | 'language' | null>(
    null,
  );

  // Keeps the permission; only stops the app using it (#67).
  const toggleLocation = act(tr('settings.recordLocation'), async () => {
    await setRecordLocation(db, !recordLocation);
    if (recordLocation) forgetPosition();
    else startPositionRequest(db);
    reload();
  });
  const toggleAppLock = act(tr('settings.appLock'), async () => {
    const next = !appLock;
    if (next) {
      // Both checks before the setting is stored: enabling a lock the phone cannot satisfy, or
      // that the user can't actually pass, would shut them out of their own ledger.
      if (!(await canUseAppLock())) {
        Alert.alert(tr('common.error'), tr('settings.appLockUnavailable'));
        return;
      }
      if (!(await authenticate(tr('lock.prompt')))) return;
    }
    await setAppLockEnabled(db, next);
    await reload();
  });

  function accountLabel(id: string | null): string {
    if (!id) return tr('settings.none');
    const active = assetAccounts.find((a) => a.id === id);
    if (active) return active.name;
    const inactive = allAssetAccounts.find((a) => a.id === id);
    return inactive ? tr('settings.inactiveAccount', { name: inactive.name }) : tr('settings.none');
  }

  const envelopeCount = assetAccounts.filter((a) => hasEnvelopeMarker(a.notes)).length;
  const version = Constants.expoConfig?.version ?? '0.1.0';

  // The summaries read the same settings their pages write.
  const receiptNames = [
    ...(localModelName.trim() !== '' && localModelUrls.length > 0
      ? [tr('sync.providerLocal')]
      : []),
    ...(hasGeminiKey ? [tr('sync.providerGemini')] : []),
  ];
  const receiptSummary = receiptNames.length > 0 ? receiptNames.join(' · ') : tr('settings.off');
  const remindersSummary = plannedNotifications
    ? reminderLeadName(plannedReminderLead)
    : tr('settings.off');
  const activeHost = ff3ActiveHost ?? ff3Hosts[0] ?? null;
  const connectionSub = demo
    ? tr('demo.value')
    : !signedIn
      ? tr('settings.notConnected')
      : activeHost
        ? shortLabel(activeHost)
        : tr('settings.connectedValue');

  const valueText = (text: string) => (
    <Text style={[t.type.body, { color: t.color.textMuted }]}>{text}</Text>
  );

  return (
    <Screen>
      <TabHeader title={tr('settings.title')} />
      <ScrollView contentContainerStyle={{ paddingBottom: t.space.xxl }}>
        <Card flush style={{ marginHorizontal: t.space.lg }}>
          <ListRow
            first
            leading={<Tile icon="server-outline" />}
            label="Firefly III"
            sub={connectionSub}
            chevron
            onPress={() => router.push('/settings/connection')}
          />
        </Card>

        <SectionHeader title={tr('settings.sectionAddMoney')} />
        <Card flush style={{ marginHorizontal: t.space.lg }}>
          <ListRow
            first
            leading={<Tile icon="wallet-outline" />}
            label={tr('settings.payFrom')}
            sub={tr('settings.payFromHint')}
            trailing={valueText(accountLabel(defaultAccountId))}
            chevron
            onPress={() => setSheet('account')}
          />
          <ListRow
            leading={<Tile icon="cash-outline" tone="warn" />}
            label={tr('settings.cashComesFrom')}
            sub={tr('settings.cashComesFromHint')}
            trailing={valueText(accountLabel(cashAccountId))}
            chevron
            onPress={() => setSheet('cashAccount')}
          />
          <ListRow
            leading={<Tile icon="logo-usd" tone="income" />}
            label={tr('fields.currency')}
            trailing={valueText(
              defaultCurrency ?? primaryCurrencyCode(currencies) ?? tr('settings.none'),
            )}
            chevron
            onPress={() => setSheet('currency')}
          />
          {flags.record_location && (
            <SwitchRow
              value={recordLocation}
              onValueChange={() => void toggleLocation()}
              label={tr('settings.recordLocation')}
              hint={tr('settings.recordLocationHint')}
            />
          )}
        </Card>

        <SectionHeader title={tr('settings.sectionReceiptReading')} />
        <Card flush style={{ marginHorizontal: t.space.lg }}>
          <ListRow
            first
            leading={<Tile icon="receipt-outline" tone="muted" />}
            label={tr('settings.receiptReading')}
            sub={receiptSummary}
            chevron
            onPress={() => router.push('/settings/receipts')}
          />
        </Card>

        <SectionHeader title={tr('settings.sectionAccountsAndMoney')} />
        <Card flush style={{ marginHorizontal: t.space.lg }}>
          <ListRow
            first
            leading={<Tile icon="albums-outline" />}
            label={tr('settings.assetAccounts')}
            trailing={valueText(
              `${assetAccounts.length} · ${tr('settings.envelopeCount', { count: envelopeCount })}`,
            )}
            chevron
            onPress={() => router.push('/settings/accounts')}
          />
          <ListRow
            leading={<Tile icon="trending-down-outline" tone="danger" />}
            label={tr('settings.liabilities')}
            chevron
            onPress={() => router.push('/settings/liabilities')}
          />
          <ListRow
            leading={<Tile icon="time-outline" tone="warn" />}
            label={tr('settings.countingCash')}
            sub={tr('settings.countingCashHint')}
            chevron
            onPress={() => router.push('/settings/cash')}
          />
          {flags.payee_nicknames && (
            <ListRow
              leading={<Tile icon="pricetag-outline" tone="income" />}
              label={tr('settings.aliases')}
              trailing={valueText(tr('settings.aliasesCount', { count: aliasesCount }))}
              chevron
              onPress={() => router.push('/settings/aliases')}
            />
          )}
        </Card>

        <SectionHeader title={tr('settings.sectionAutomation')} />
        <Card flush style={{ marginHorizontal: t.space.lg }}>
          {flags.ff3_rules && (
            <ListRow
              first
              leading={<Tile icon="flash-outline" />}
              label={tr('rules.title')}
              chevron
              onPress={() => router.push('/settings/rules')}
            />
          )}
          <ListRow
            first={!flags.ff3_rules}
            leading={<Tile icon="repeat-outline" />}
            label={tr('settings.plannedRaw')}
            sub={tr('settings.plannedRawHint')}
            chevron
            onPress={() => router.push('/settings/planned-raw')}
          />
        </Card>

        <SectionHeader title={tr('settings.sectionPrivacyReminders')} />
        <Card flush style={{ marginHorizontal: t.space.lg }}>
          {flags.app_lock && (
            <SwitchRow
              first
              value={appLock}
              onValueChange={() => void toggleAppLock()}
              label={tr('settings.appLock')}
              hint={tr('settings.appLockHint')}
            />
          )}
          <ListRow
            first={!flags.app_lock}
            leading={<Tile icon="notifications-outline" tone="danger" />}
            label={tr('settings.reminders')}
            sub={remindersSummary}
            chevron
            onPress={() => router.push('/settings/reminders')}
          />
        </Card>

        <SectionHeader title={tr('settings.sectionApp')} />
        <Card flush style={{ marginHorizontal: t.space.lg }}>
          <ListRow
            first
            leading={<Tile icon="language-outline" />}
            label={tr('settings.language')}
            trailing={valueText(tr(LANGUAGE_OPTIONS.find((o) => o.value === locale)!.labelKey))}
            chevron
            onPress={() => setSheet('language')}
          />
          <ListRow
            leading={<Tile icon="information-circle-outline" tone="muted" />}
            label={tr('settings.aboutAndHelp')}
            sub={tr('settings.aboutSub', { version })}
            chevron
            onPress={() => router.push('/settings/about')}
          />
        </Card>
      </ScrollView>

      <AccountPickerSheet
        visible={sheet === 'account'}
        onClose={() => setSheet(null)}
        title={tr('settings.defaultAccount')}
        accounts={assetAccounts}
        currencies={currencies}
        selectedId={defaultAccountId}
        onSelect={act(tr('settings.defaultAccount'), async (a: { id: string }) => {
          await setDefaultSourceAccountId(db, a.id);
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

      <AccountPickerSheet
        visible={sheet === 'cashAccount'}
        onClose={() => setSheet(null)}
        title={tr('settings.cashPaymentsUse')}
        accounts={assetAccounts}
        currencies={currencies}
        selectedId={cashAccountId}
        onSelect={act(tr('settings.cashPaymentsUse'), async (a: { id: string }) => {
          await setCashAccountId(db, a.id);
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
