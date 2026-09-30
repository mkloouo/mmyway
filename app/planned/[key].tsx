// One planned transaction in the simple view: its subscription, rule and recurring transaction
// edited together (src/planned/model.ts). Save queues it like any other change.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useDb } from '../../src/providers/DbProvider';
import { useCategories, useCurrencyRows } from '../../src/db/useReferenceData';
import { useTheme } from '../../src/ui/theme';
import {
  Screen,
  AppBar,
  BarIconButton,
  Button,
  Card,
  Chip,
  Row,
  SectionHeader,
  CloseButton,
} from '../../src/ui/components';
import { TextField } from '../../src/ui/TextField';
import { PickerSheet } from '../../src/ui/PickerSheet';
import { AccountPickerSheet } from '../../src/ui/AccountPickerSheet';
import { PayeeSheet } from '../../src/ui/PayeeSheet';
import { AmountSheet } from '../../src/ui/AmountSheet';
import { Checkbox } from '../../src/ui/Checkbox';
import { pickDate, pickTime } from '../../src/ui/pickDate';
import { currencyOf, formatMoney } from '../../src/ui/money';
import { pickableCurrencies, primaryCurrencyCode } from '../../src/ui/currencies';
import { useAction } from '../../src/ui/useAction';
import { referenceCurrencies } from '../../src/db/schema';
import { useAssetAccounts } from '../../src/accounts/useAssetAccounts';
import type { MerchantHistory } from '../../src/lookup/merchantLookup';
import { useMerchantHistories } from '../../src/lookup/useMerchantHistories';
import { getDefaultCurrencyCode, getDefaultSourceAccountId } from '../../src/settings/appSettings';
import { usePlanned } from '../../src/planned/usePlanned';
import {
  FREQUENCIES,
  plannedProblems,
  samePlannedFields,
  type PlannedFields,
} from '../../src/planned/model';
import { dayLabel, frequencyName } from '../../src/planned/labels';
import { deletePlanned, savePlanned } from '../../src/planned/actions';
import type { PlannedItem } from '../../src/planned/items';
import { localDay } from '../../src/utils/day';
import { TX_TYPES } from '../../src/transactions/txTypes';

type TxType = PlannedFields['type'];

function blank(): PlannedFields {
  return {
    name: '',
    type: 'withdrawal',
    sourceId: null,
    sourceName: null,
    destinationId: null,
    destinationName: null,
    amount: '0',
    currencyCode: '',
    notes: null,
    repeats: true,
    frequency: 'monthly',
    every: 1,
    date: localDay(),
    time: null,
    categoryName: null,
    tags: [],
  };
}

export default function PlannedEditScreen() {
  const { key: rawKey } = useLocalSearchParams<{ key: string }>();
  const key = decodeURIComponent(rawKey ?? 'new');
  const isNew = key === 'new';
  const t = useTheme();
  const { t: tr } = useTranslation();
  const { items, loaded } = usePlanned();
  const item = isNew ? null : (items.find((i) => i.key === key) ?? null);

  if (!isNew && !item) {
    return (
      <Screen bottom>
        <AppBar title={tr('planned.title')} left={<CloseButton onPress={() => router.back()} />} />
        {loaded && (
          <Text style={[t.type.body, { color: t.color.textMuted, padding: t.space.lg }]}>
            {tr('planned.gone')}
          </Text>
        )}
      </Screen>
    );
  }
  // Mounted once the item is known, so the form starts from its fields.
  return <PlannedEditor item={item} />;
}

function PlannedEditor({ item }: { item: PlannedItem | null }) {
  const isNew = !item;
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const act = useAction();
  const assetAccounts = useAssetAccounts({ includeLiabilities: true }) ?? [];
  const categories = useCategories();
  // undefined until the reference currencies load: the amount would otherwise be drawn with the
  // currency code standing in for its symbol, then redrawn a frame later at a different width.
  const currencyRows = useCurrencyRows();
  const currencies = currencyRows ?? [];

  const [fields, setFields] = useState<PlannedFields>(() => item?.fields ?? blank());
  const [tagsText, setTagsText] = useState(() => item?.fields.tags.join(', ') ?? '');
  const [sheet, setSheet] = useState<
    'amount' | 'currency' | 'own' | 'ownTo' | 'payee' | 'category' | 'frequency' | null
  >(null);
  // What the user chose themselves: a payee's history never overwrites those. The default
  // account a new one starts with isn't a choice, so history may replace it.
  const [chosen, setChosen] = useState<{ category: boolean; account: boolean }>(() => ({
    category: !!item?.fields.categoryName,
    account: !!item,
  }));

  // A new one starts from capture's defaults: the default account and currency.
  useEffect(() => {
    if (!isNew) return;
    void (async () => {
      const [accountId, currency, currencyRows] = await Promise.all([
        getDefaultSourceAccountId(db),
        getDefaultCurrencyCode(db),
        db.select().from(referenceCurrencies),
      ]);
      setFields((f) => ({
        ...f,
        sourceId: f.sourceId ?? accountId,
        currencyCode: f.currencyCode || currency || primaryCurrencyCode(currencyRows) || '',
      }));
    })();
  }, [isNew, db]);

  const payeeType = fields.type === 'deposit' ? 'deposit' : 'withdrawal';
  const histories = useMerchantHistories(payeeType);

  const set = (patch: Partial<PlannedFields>) => setFields((f) => ({ ...f, ...patch }));
  const currency = currencyOf(currencies, fields.currencyCode);
  const problems = plannedProblems(fields);
  const accountName = (id: string | null, name: string | null) =>
    (id ? (assetAccounts.find((a) => a.id === id)?.name ?? name) : name) ?? '—';

  // Which end is the user's own account and which the payee/payer.
  const ownFrom = fields.type !== 'deposit';
  const ownTo = fields.type !== 'withdrawal';

  /**
   * A payee picked from history also fills what's usually booked with it — its category and the
   * account it's usually paid from — where the user hasn't chosen one.
   */
  function choosePayee(h: MerchantHistory) {
    const patch: Partial<PlannedFields> =
      fields.type === 'deposit'
        ? { sourceName: h.displayName, sourceId: null }
        : { destinationName: h.displayName, destinationId: null };
    if (!chosen.category && !fields.categoryName && h.topCategory)
      patch.categoryName = h.topCategory;
    const account =
      !chosen.account && h.topAccountName
        ? assetAccounts.find((a) => a.name === h.topAccountName)
        : undefined;
    if (account) {
      if (fields.type === 'deposit') {
        patch.destinationId = account.id;
        patch.destinationName = account.name;
      } else {
        patch.sourceId = account.id;
        patch.sourceName = account.name;
      }
    }
    set(patch);
  }

  /** The own account moves to the end the new type keeps it on; the payee/payer starts empty. */
  function changeType(type: TxType) {
    if (type === fields.type) return;
    const own = ownFrom
      ? { id: fields.sourceId, name: fields.sourceName }
      : { id: fields.destinationId, name: fields.destinationName };
    const none = { id: null, name: null };
    const source = type === 'deposit' ? none : own;
    const destination = type === 'withdrawal' ? none : type === 'deposit' ? own : none;
    set({
      type,
      sourceId: source.id,
      sourceName: source.name,
      destinationId: destination.id,
      destinationName: destination.name,
    });
  }

  const next: PlannedFields = {
    ...fields,
    name: fields.name.trim(),
    tags: tagsText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
  // Save stays off until something differs from what Firefly III holds (or a queued save does).
  const unchanged = !!item && samePlannedFields(item.fields, next);
  const onSave = act(tr('common.save'), async () => {
    if (problems.length > 0 || unchanged) return;
    await savePlanned(db, item, next);
    router.back();
  });
  const saving = act.pending(tr('common.save'));

  const deleteNow = act(tr('common.delete'), async () => {
    if (!item) return;
    await deletePlanned(db, item);
    router.back();
  });

  function onDelete() {
    if (!item) return;
    Alert.alert(tr('planned.deleteTitle', { name: item.fields.name }), tr('planned.deleteBody'), [
      { text: tr('common.cancel'), style: 'cancel' },
      {
        text: tr('common.delete'),
        style: 'destructive',
        onPress: () => void deleteNow(),
      },
    ]);
  }

  return (
    <Screen bottom avoidKeyboard>
      <AppBar
        title={isNew ? tr('planned.newTitle') : fields.name || tr('planned.title')}
        left={<CloseButton onPress={() => router.back()} />}
        right={
          item ? (
            <BarIconButton icon="trash-outline" label={tr('common.delete')} onPress={onDelete} />
          ) : undefined
        }
      />
      <ScrollView
        contentContainerStyle={{ paddingBottom: t.space.xxl }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ flexDirection: 'row', gap: t.space.sm, paddingHorizontal: t.space.lg }}>
          {TX_TYPES.map((x) => (
            <Chip
              key={x.type}
              label={tr(x.labelKey)}
              selected={fields.type === x.type}
              onPress={() => changeType(x.type)}
            />
          ))}
        </View>

        <SectionHeader title={tr('planned.sectionWhat')} />
        <Card style={{ marginHorizontal: t.space.lg, gap: t.space.sm }}>
          <Text style={[t.type.label, { color: t.color.textMuted }]}>{tr('planned.name')}</Text>
          <TextField
            value={fields.name}
            onChangeText={(name) => set({ name })}
            placeholder={tr('planned.namePlaceholder')}
          />
          <Row
            label={tr('fields.amount')}
            value={currencyRows ? formatMoney(fields.amount, currency) : ''}
            chevron
            onPress={() => setSheet('amount')}
          />
          <Row
            label={tr('fields.currency')}
            value={fields.currencyCode || '—'}
            chevron
            onPress={() => setSheet('currency')}
          />
          <Row
            label={tr('fields.from')}
            value={
              ownFrom ? accountName(fields.sourceId, fields.sourceName) : (fields.sourceName ?? '—')
            }
            chevron
            onPress={() => setSheet(ownFrom ? 'own' : 'payee')}
          />
          <Row
            label={tr('fields.to')}
            value={
              ownTo
                ? accountName(fields.destinationId, fields.destinationName)
                : (fields.destinationName ?? '—')
            }
            chevron
            onPress={() => setSheet(ownTo ? 'ownTo' : 'payee')}
          />
          <Row
            label={tr('fields.category')}
            value={fields.categoryName ?? '—'}
            chevron
            onPress={() => setSheet('category')}
          />
        </Card>
        <Text
          style={[
            t.type.label,
            { color: t.color.textMuted, paddingHorizontal: t.space.xl, paddingTop: t.space.sm },
          ]}
        >
          {tr('planned.amountHint')}
        </Text>

        <SectionHeader title={tr('planned.sectionWhen')} />
        <Card style={{ marginHorizontal: t.space.lg }}>
          <Row
            first
            label={tr('planned.plannedOn')}
            value={dayLabel(fields.date)}
            chevron
            onPress={() =>
              pickDate(new Date(`${fields.date}T12:00:00`), (d) => set({ date: localDay(d) }))
            }
          />
          <Row
            label={tr('planned.time')}
            value={fields.time ?? tr('planned.anyTime')}
            chevron
            onPress={() => pickTime(fields.time, (time) => set({ time }))}
          />
          {!!fields.time && (
            <Row
              label={tr('planned.clearTime')}
              icon="close-circle-outline"
              onPress={() => set({ time: null })}
            />
          )}
          <Checkbox
            checked={fields.repeats}
            onPress={() => set({ repeats: !fields.repeats })}
            label={tr('planned.repeats')}
            hint={tr('planned.repeatsHint')}
          />
          {fields.repeats && (
            <>
              <Row
                label={tr('planned.frequencyLabel')}
                value={frequencyName(fields.frequency)}
                chevron
                onPress={() => setSheet('frequency')}
              />
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: t.space.md,
                  paddingVertical: t.space.sm,
                  borderTopWidth: 1,
                  borderTopColor: t.color.border,
                }}
              >
                <Text style={[t.type.body, { color: t.color.textMuted, flex: 1 }]}>
                  {tr('planned.everyN', { count: fields.every })}
                </Text>
                <Button
                  title="−"
                  variant="secondary"
                  onPress={() => set({ every: Math.max(1, fields.every - 1) })}
                  disabled={fields.every <= 1}
                />
                <Button
                  title="+"
                  variant="secondary"
                  onPress={() => set({ every: fields.every + 1 })}
                />
              </View>
            </>
          )}
        </Card>
        {!!fields.time && (
          <Text
            style={[
              t.type.label,
              { color: t.color.textMuted, paddingHorizontal: t.space.xl, paddingTop: t.space.sm },
            ]}
          >
            {tr('planned.timeHint')}
          </Text>
        )}

        <SectionHeader title={tr('planned.sectionMore')} />
        <Card style={{ marginHorizontal: t.space.lg, gap: t.space.sm }}>
          <Text style={[t.type.label, { color: t.color.textMuted }]}>{tr('fields.note')}</Text>
          <TextField
            value={fields.notes ?? ''}
            onChangeText={(notes) => set({ notes: notes || null })}
            multiline
            style={{ minHeight: 60 }}
          />
          <Text style={[t.type.label, { color: t.color.textMuted }]}>{tr('fields.tags')}</Text>
          <TextField
            value={tagsText}
            onChangeText={setTagsText}
            placeholder={tr('planned.tagsPlaceholder')}
            autoCapitalize="none"
          />
        </Card>
      </ScrollView>

      <View style={{ padding: t.space.lg, gap: t.space.sm }}>
        {problems.length > 0 && (
          <Text style={[t.type.label, { color: t.color.warn, textAlign: 'center' }]}>
            {tr('readiness.missing', {
              fields: problems.map((p) => tr(`planned.problem.${p}`)).join(', '),
            })}
          </Text>
        )}
        <Button
          title={saving ? tr('common.saving') : tr('common.save')}
          onPress={onSave}
          disabled={saving || unchanged || problems.length > 0}
          size="lg"
        />
      </View>

      <AmountSheet
        visible={sheet === 'amount'}
        title={tr('fields.amount')}
        initial={fields.amount}
        currency={currency}
        type={fields.type}
        onDone={(typed) => {
          if (typed !== null) setFields((f) => ({ ...f, amount: typed }));
          setSheet(null);
        }}
      />
      <PickerSheet
        visible={sheet === 'currency'}
        onClose={() => setSheet(null)}
        title={tr('fields.currency')}
        options={pickableCurrencies(currencies, fields.currencyCode).map((c) => ({
          key: c.code,
          label: c.code,
        }))}
        selected={fields.currencyCode}
        onSelect={(code) => {
          if (code) set({ currencyCode: code });
        }}
      />
      <AccountPickerSheet
        visible={sheet === 'own' || sheet === 'ownTo'}
        onClose={() => setSheet(null)}
        title={sheet === 'ownTo' ? tr('fields.to') : tr('fields.from')}
        accounts={assetAccounts}
        currencies={currencies}
        onSelect={(a) => {
          setChosen((c) => ({ ...c, account: true }));
          set(
            sheet === 'ownTo'
              ? { destinationId: a.id, destinationName: a.name }
              : { sourceId: a.id, sourceName: a.name },
          );
        }}
      />
      <PayeeSheet
        visible={sheet === 'payee'}
        onClose={() => setSheet(null)}
        histories={histories}
        payeeLabel={fields.type === 'deposit' ? 'payer' : 'payee'}
        onSelect={choosePayee}
        onCreateNew={(text) =>
          set(
            fields.type === 'deposit'
              ? { sourceName: text, sourceId: null }
              : { destinationName: text, destinationId: null },
          )
        }
      />
      <PickerSheet
        visible={sheet === 'category'}
        onClose={() => setSheet(null)}
        title={tr('fields.category')}
        options={categories.map((c) => ({ key: c.name, label: c.name }))}
        selected={fields.categoryName}
        onSelect={(categoryName) => {
          setChosen((c) => ({ ...c, category: true }));
          set({ categoryName });
        }}
        noneLabel={tr('common.none')}
      />
      <PickerSheet
        visible={sheet === 'frequency'}
        onClose={() => setSheet(null)}
        title={tr('planned.frequencyLabel')}
        options={FREQUENCIES.map((f) => ({ key: f, label: frequencyName(f) }))}
        selected={fields.frequency}
        onSelect={(f) => {
          const found = FREQUENCIES.find((x) => x === f);
          if (found) set({ frequency: found });
        }}
      />
    </Screen>
  );
}
