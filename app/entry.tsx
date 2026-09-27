import { useEffect, useState } from 'react';
import { View, Text, TextInput, Button, ScrollView, Switch } from 'react-native';
import { router } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useDb } from '../src/providers/DbProvider';
import { referenceAccounts, referenceCategories, referenceBudgets, referenceCurrencies } from '../src/db/schema';
import { createManualEntry, type ManualEntryInput } from '../src/inbox/createManualEntry';
import { getDefaultSourceAccountId, getDefaultCurrencyCode } from '../src/settings/appSettings';
import type { Draft } from '../src/inbox/draft';

const TYPES: Draft['type'][] = ['withdrawal', 'deposit', 'transfer'];

function Picker<T extends { id?: string; code?: string; name?: string }>({
  label, items, selectedId, onSelect, getId, getLabel,
}: {
  label: string;
  items: T[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  getId: (item: T) => string;
  getLabel: (item: T) => string;
}) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ fontWeight: 'bold' }}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {items.map((item) => {
          const id = getId(item);
          return (
            <Text
              key={id}
              onPress={() => onSelect(id)}
              style={{ padding: 6, borderWidth: 1, borderColor: id === selectedId ? '#000' : '#ccc', fontWeight: id === selectedId ? 'bold' : 'normal' }}
            >
              {getLabel(item)}
            </Text>
          );
        })}
      </View>
    </View>
  );
}

export default function EntryScreen() {
  const db = useDb();
  const { data: accounts } = useLiveQuery(db.select().from(referenceAccounts));
  const { data: categories } = useLiveQuery(db.select().from(referenceCategories));
  const { data: budgets } = useLiveQuery(db.select().from(referenceBudgets));
  const { data: currencies } = useLiveQuery(db.select().from(referenceCurrencies));
  const assetAccounts = (accounts ?? []).filter((a) => a.type === 'asset');

  const [type, setType] = useState<Draft['type']>('withdrawal');
  const [amount, setAmount] = useState('');
  const [currencyCode, setCurrencyCode] = useState<string | null>(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [merchantRawInput, setMerchantRawInput] = useState('');
  const [forceNewPayee, setForceNewPayee] = useState(false);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [destinationId, setDestinationId] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState<string | null>(null);
  const [budgetId, setBudgetId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [sharedWith, setSharedWith] = useState('');
  const [foreignAmount, setForeignAmount] = useState('');
  const [foreignCurrencyCode, setForeignCurrencyCode] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const [defaultAccountId, defaultCurrency] = await Promise.all([getDefaultSourceAccountId(db), getDefaultCurrencyCode(db)]);
      if (defaultAccountId) setSourceId((current) => current ?? defaultAccountId);
      if (defaultCurrency) setCurrencyCode((current) => current ?? defaultCurrency);
    })();
  }, [db]);

  const needsPayee = type === 'withdrawal' || type === 'deposit';
  const needsSource = type === 'withdrawal' || type === 'transfer';
  const needsDestination = type === 'deposit' || type === 'transfer';

  async function onSave() {
    if (!amount || !currencyCode || saving) return;
    setSaving(true);
    try {
      const sourceAccount = assetAccounts.find((a) => a.id === sourceId);
      const destinationAccount = assetAccounts.find((a) => a.id === destinationId);
      const input: ManualEntryInput = {
        type, amount, currencyCode, date: new Date(date).toISOString(),
        description: description || merchantRawInput || type,
        merchantRawInput: needsPayee ? merchantRawInput : undefined,
        forceNewPayee: needsPayee ? forceNewPayee : undefined,
        sourceId: needsSource ? sourceId ?? undefined : undefined,
        sourceName: needsSource ? sourceAccount?.name : undefined,
        destinationId: needsDestination ? destinationId ?? undefined : undefined,
        destinationName: needsDestination ? destinationAccount?.name : undefined,
        categoryName: categoryName ?? undefined,
        budgetId: budgetId ?? undefined,
        notes: notes || undefined,
        foreignAmount: foreignAmount || undefined,
        foreignCurrencyCode: foreignAmount ? foreignCurrencyCode ?? undefined : undefined,
        sharedWith: sharedWith || undefined,
      };
      const { inboxItemId } = await createManualEntry(db, input);
      router.replace(`/draft/${inboxItemId}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 20, fontWeight: 'bold' }}>New entry</Text>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        {TYPES.map((t) => (
          <Text
            key={t}
            onPress={() => setType(t)}
            style={{ padding: 8, borderWidth: 1, borderColor: t === type ? '#000' : '#ccc', fontWeight: t === type ? 'bold' : 'normal' }}
          >
            {t}
          </Text>
        ))}
      </View>

      <TextInput placeholder="Amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" style={{ borderWidth: 1, padding: 8 }} />
      <Picker label="Currency" items={currencies ?? []} selectedId={currencyCode} onSelect={setCurrencyCode} getId={(c) => c.code} getLabel={(c) => c.code} />
      <TextInput placeholder="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} style={{ borderWidth: 1, padding: 8 }} />
      <TextInput placeholder="Description" value={description} onChangeText={setDescription} style={{ borderWidth: 1, padding: 8 }} />

      {needsPayee && (
        <>
          <TextInput
            placeholder={type === 'withdrawal' ? 'Payee' : 'Payer'}
            value={merchantRawInput}
            onChangeText={setMerchantRawInput}
            style={{ borderWidth: 1, padding: 8 }}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Switch value={forceNewPayee} onValueChange={setForceNewPayee} />
            <Text>New payee</Text>
          </View>
        </>
      )}

      {needsSource && (
        <Picker label="Source account" items={assetAccounts} selectedId={sourceId} onSelect={setSourceId} getId={(a) => a.id} getLabel={(a) => a.name} />
      )}
      {needsDestination && (
        <Picker label="Destination account" items={assetAccounts} selectedId={destinationId} onSelect={setDestinationId} getId={(a) => a.id} getLabel={(a) => a.name} />
      )}

      <Picker label="Category" items={categories ?? []} selectedId={categoryName} onSelect={setCategoryName} getId={(c) => c.name} getLabel={(c) => c.name} />
      <Picker label="Budget" items={budgets ?? []} selectedId={budgetId} onSelect={setBudgetId} getId={(b) => b.id} getLabel={(b) => b.name} />

      <TextInput placeholder="Notes" value={notes} onChangeText={setNotes} style={{ borderWidth: 1, padding: 8 }} />
      <TextInput placeholder="Shared with (person)" value={sharedWith} onChangeText={setSharedWith} style={{ borderWidth: 1, padding: 8 }} />

      <Text style={{ fontWeight: 'bold' }}>Foreign amount (optional)</Text>
      <TextInput placeholder="Foreign amount" value={foreignAmount} onChangeText={setForeignAmount} keyboardType="decimal-pad" style={{ borderWidth: 1, padding: 8 }} />
      {!!foreignAmount && (
        <Picker label="Foreign currency" items={currencies ?? []} selectedId={foreignCurrencyCode} onSelect={setForeignCurrencyCode} getId={(c) => c.code} getLabel={(c) => c.code} />
      )}

      <Button title={saving ? 'Saving…' : 'Save'} onPress={onSave} disabled={saving} />
    </ScrollView>
  );
}
