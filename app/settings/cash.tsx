// Settings → Counting cash: where the cash count books its differences — the shortfall and surplus
// payees and the category. The same settings the count's own settings sheet writes.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCategories, useCurrencies } from '../../src/db/useReferenceData';
import { useLiveQuery } from '../../src/db/useLiveQuery';
import { referenceAccounts } from '../../src/db/schema';
import { useDb } from '../../src/providers/DbProvider';
import { useTheme } from '../../src/ui/theme';
import {
  Card,
  ListRow,
  PushHeader,
  SCREEN_TOP_PADDING,
  Screen,
  SectionHeader,
} from '../../src/ui/kit';
import { PickerSheet } from '../../src/ui/PickerSheet';
import { AccountPickerSheet, type AccountPickerAccount } from '../../src/ui/AccountPickerSheet';
import { useAction } from '../../src/ui/useAction';
import { SETTINGS_QUERY_KEY } from '../../src/settings/loadSettings';
import {
  getReconcileCategoryName,
  getReconcileShortfallAccountId,
  getReconcileSurplusAccountId,
  setReconcileCategoryName,
  setReconcileShortfallAccountId,
  setReconcileSurplusAccountId,
} from '../../src/settings/appSettings';

type PickerKind = 'shortfall' | 'surplus' | 'category';

export default function CashSettingsScreen() {
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const act = useAction();
  const queryClient = useQueryClient();
  const categories = useCategories();
  const currencies = useCurrencies();

  const { data: accountRows } = useLiveQuery(db.select().from(referenceAccounts));
  const allAccounts = accountRows ?? [];
  const expenseAccounts = allAccounts.filter((a) => a.type === 'expense');
  const revenueAccounts = allAccounts.filter((a) => a.type === 'revenue');

  const { data: saved } = useQuery({
    queryKey: [...SETTINGS_QUERY_KEY, 'cashCount'],
    queryFn: async () => ({
      shortfallId: await getReconcileShortfallAccountId(db),
      surplusId: await getReconcileSurplusAccountId(db),
      category: (await getReconcileCategoryName(db)) || null,
    }),
  });
  const reload = () => {
    void queryClient.invalidateQueries({ queryKey: SETTINGS_QUERY_KEY });
  };

  const [picker, setPicker] = useState<PickerKind | null>(null);

  // An unset payee falls back to the account named like the default, as the count does.
  const matchingShortfall = expenseAccounts.find(
    (a) => /^cash shortfall$/i.test(a.name) || /shortfall|reconcil/i.test(a.name),
  );
  const matchingSurplus = revenueAccounts.find(
    (a) => /^cash surplus$/i.test(a.name) || /surplus|reconcil/i.test(a.name),
  );
  const selectedShortfall = expenseAccounts.find((a) => a.id === saved?.shortfallId);
  const effectiveShortfall = selectedShortfall ?? matchingShortfall ?? null;
  const selectedSurplus = revenueAccounts.find((a) => a.id === saved?.surplusId);
  const effectiveSurplus = selectedSurplus ?? matchingSurplus ?? null;
  const category = saved?.category ?? null;

  const pickShortfall = act(tr('count.shortfallPayee'), async (a: AccountPickerAccount) => {
    await setReconcileShortfallAccountId(db, a.id);
    reload();
  });
  const pickSurplus = act(tr('count.surplusPayee'), async (a: AccountPickerAccount) => {
    await setReconcileSurplusAccountId(db, a.id);
    reload();
  });
  const pickCategory = act(tr('count.categoryOptional'), async (key: string | null) => {
    await setReconcileCategoryName(db, key ?? '');
    reload();
  });

  const valueText = (s: string) => (
    <Text style={[t.type.body, { color: t.color.textMuted }]}>{s}</Text>
  );

  return (
    <Screen>
      <PushHeader
        backLabel={tr('settings.title')}
        onBack={() => router.back()}
        title={tr('settings.countingCash')}
      />
      <ScrollView
        contentContainerStyle={{ paddingBottom: t.space.xxl, paddingTop: SCREEN_TOP_PADDING }}
      >
        <SectionHeader first title={tr('count.bookedAs')} />
        <Card flush style={{ marginHorizontal: t.space.lg }}>
          <ListRow
            first
            label={tr('count.shortfallPayee')}
            trailing={valueText(effectiveShortfall?.name ?? tr('count.defaultPayeeShortfall'))}
            chevron
            onPress={() => setPicker('shortfall')}
          />
          <ListRow
            label={tr('count.surplusPayee')}
            trailing={valueText(effectiveSurplus?.name ?? tr('count.defaultPayeeSurplus'))}
            chevron
            onPress={() => setPicker('surplus')}
          />
          <ListRow
            label={tr('count.categoryOptional')}
            trailing={valueText(category ?? tr('common.none'))}
            chevron
            onPress={() => setPicker('category')}
          />
        </Card>
      </ScrollView>

      <AccountPickerSheet
        visible={picker === 'shortfall'}
        onClose={() => setPicker(null)}
        title={tr('count.shortfallPayee')}
        accounts={expenseAccounts}
        currencies={currencies}
        suggested={
          expenseAccounts.some((a) => /^cash shortfall$/i.test(a.name))
            ? undefined
            : [{ id: '', name: tr('count.defaultShortfallPayee'), currencyCode: '' }]
        }
        selectedId={selectedShortfall?.id ?? effectiveShortfall?.id ?? ''}
        onSelect={(a) => void pickShortfall(a)}
      />
      <AccountPickerSheet
        visible={picker === 'surplus'}
        onClose={() => setPicker(null)}
        title={tr('count.surplusPayee')}
        accounts={revenueAccounts}
        currencies={currencies}
        suggested={
          revenueAccounts.some((a) => /^cash surplus$/i.test(a.name))
            ? undefined
            : [{ id: '', name: tr('count.defaultSurplusPayee'), currencyCode: '' }]
        }
        selectedId={selectedSurplus?.id ?? effectiveSurplus?.id ?? ''}
        onSelect={(a) => void pickSurplus(a)}
      />
      <PickerSheet
        visible={picker === 'category'}
        onClose={() => setPicker(null)}
        title={tr('count.categoryOptional')}
        options={categories.map((c) => ({ key: c.name, label: c.name }))}
        selected={category}
        noneLabel={tr('common.none')}
        onSelect={(key) => void pickCategory(key)}
      />
    </Screen>
  );
}
