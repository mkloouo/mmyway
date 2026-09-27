import { useEffect, useState } from 'react';
import { View, Text, TextInput, Button, ScrollView, Switch } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { eq } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useDb } from '../../src/providers/DbProvider';
import { inboxItems, referenceAccounts, referenceCategories, referenceBudgets } from '../../src/db/schema';
import { confirmInboxItem } from '../../src/inbox/createManualEntry';
import { updateDraft } from '../../src/inbox/updateDraft';
import { buildMerchantLookup } from '../../src/lookup/merchantLookup';
import { rankCandidates } from '../../src/suggest/rank';
import type { Draft } from '../../src/inbox/draft';

function ChipPicker({ label, items, selectedId, onSelect }: { label: string; items: { id: string; name: string }[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ fontWeight: 'bold' }}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {items.map((item) => (
          <Text
            key={item.id}
            onPress={() => onSelect(item.id)}
            style={{ padding: 6, borderWidth: 1, borderColor: item.id === selectedId ? '#000' : '#ccc', fontWeight: item.id === selectedId ? 'bold' : 'normal' }}
          >
            {item.name}
          </Text>
        ))}
      </View>
    </View>
  );
}

export default function DraftScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDb();
  const { data: rows } = useLiveQuery(db.select().from(inboxItems).where(eq(inboxItems.id, id)));
  const { data: accounts } = useLiveQuery(db.select().from(referenceAccounts));
  const { data: categories } = useLiveQuery(db.select().from(referenceCategories));
  const { data: budgets } = useLiveQuery(db.select().from(referenceBudgets));
  const assetAccounts = (accounts ?? []).filter((a) => a.type === 'asset');
  const row = rows?.[0];
  const draft: Draft | null = row ? JSON.parse(row.draftJson) : null;

  const [suggestions, setSuggestions] = useState<{ merchantKey: string; displayName: string; topCategory: string | null; topAccountName: string | null; topBudgetName: string | null }[]>([]);
  const [confirming, setConfirming] = useState(false);

  const payeeName = draft?.type === 'deposit' ? draft.sourceName : draft?.destinationName;

  useEffect(() => {
    (async () => {
      const histories = [...(await buildMerchantLookup(db)).values()];
      const ranked = rankCandidates(histories, { merchantQuery: payeeName ?? undefined });
      setSuggestions(
        ranked.slice(0, 5).map((c) => {
          const full = histories.find((h) => h.merchantKey === c.merchantKey)!;
          return { merchantKey: full.merchantKey, displayName: full.displayName, topCategory: full.topCategory, topAccountName: full.topAccountName, topBudgetName: full.topBudgetName };
        }),
      );
    })();
  }, [db, payeeName]);

  if (!draft || !row) return <Text>Loading…</Text>;

  const readOnly = row.state === 'confirmed' || row.state === 'synced';

  async function patch(fields: Partial<Draft>) {
    await updateDraft(db, id, fields);
  }

  function applySuggestion(s: (typeof suggestions)[number]) {
    const account = assetAccounts.find((a) => a.name === s.topAccountName);
    const budget = (budgets ?? []).find((b) => b.name === s.topBudgetName);
    patch({
      categoryName: s.topCategory ?? draft!.categoryName,
      budgetId: budget?.id ?? draft!.budgetId,
      ...(draft!.type === 'withdrawal' ? { sourceId: account?.id ?? draft!.sourceId } : {}),
      ...(draft!.type === 'deposit' ? { destinationId: account?.id ?? draft!.destinationId } : {}),
    });
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 18, fontWeight: 'bold' }}>{draft.type} · {row.state}</Text>

      <TextInput
        placeholder="Amount" value={draft.amount} editable={!readOnly}
        onChangeText={(v) => patch({ amount: v })} keyboardType="decimal-pad" style={{ borderWidth: 1, padding: 8 }}
      />
      <TextInput
        placeholder="Currency" value={draft.currencyCode} editable={!readOnly}
        onChangeText={(v) => patch({ currencyCode: v })} style={{ borderWidth: 1, padding: 8 }}
      />
      <TextInput
        placeholder="Description" value={draft.description} editable={!readOnly}
        onChangeText={(v) => patch({ description: v })} style={{ borderWidth: 1, padding: 8 }}
      />

      {draft.type !== 'transfer' && (
        <View style={{ gap: 4 }}>
          <TextInput
            placeholder={draft.type === 'withdrawal' ? 'Payee' : 'Payer'}
            value={payeeName ?? ''}
            editable={!readOnly}
            onChangeText={(v) => patch(draft.type === 'withdrawal' ? { destinationName: v } : { sourceName: v })}
            style={{ borderWidth: 1, padding: 8 }}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Switch
              value={draft.isNewPayee} disabled={readOnly}
              onValueChange={(v) => patch(
                draft.type === 'withdrawal'
                  ? { isNewPayee: v, destinationId: v ? undefined : draft.destinationId }
                  : { isNewPayee: v, sourceId: v ? undefined : draft.sourceId },
              )}
            />
            <Text style={{ fontWeight: draft.isNewPayee ? 'bold' : 'normal' }}>
              {draft.isNewPayee ? 'New payee' : 'Matched existing payee'}
            </Text>
          </View>
        </View>
      )}

      {(draft.type === 'withdrawal' || draft.type === 'transfer') && (
        <ChipPicker label="Source account" items={assetAccounts} selectedId={draft.sourceId ?? null} onSelect={(v) => patch({ sourceId: v })} />
      )}
      {(draft.type === 'deposit' || draft.type === 'transfer') && (
        <ChipPicker label="Destination account" items={assetAccounts} selectedId={draft.destinationId ?? null} onSelect={(v) => patch({ destinationId: v })} />
      )}

      <ChipPicker label="Category" items={(categories ?? []).map((c) => ({ id: c.name, name: c.name }))} selectedId={draft.categoryName ?? null} onSelect={(v) => patch({ categoryName: v })} />
      <ChipPicker label="Budget" items={budgets ?? []} selectedId={draft.budgetId ?? null} onSelect={(v) => patch({ budgetId: v })} />

      {suggestions.length > 0 && !readOnly && (
        <View style={{ gap: 4 }}>
          <Text style={{ fontWeight: 'bold' }}>Suggestions</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {suggestions.map((s) => (
              <Text key={s.merchantKey} onPress={() => applySuggestion(s)} style={{ padding: 6, borderWidth: 1, borderColor: '#888' }}>
                {s.displayName}: {s.topCategory ?? '–'} / {s.topAccountName ?? '–'}
              </Text>
            ))}
          </View>
        </View>
      )}

      <TextInput placeholder="Notes" value={draft.notes ?? ''} editable={!readOnly} onChangeText={(v) => patch({ notes: v })} style={{ borderWidth: 1, padding: 8 }} />
      <TextInput placeholder="Shared with" value={draft.sharedWith ?? ''} editable={!readOnly} onChangeText={(v) => patch({ sharedWith: v })} style={{ borderWidth: 1, padding: 8 }} />
      <TextInput placeholder="Foreign amount" value={draft.foreignAmount ?? ''} editable={!readOnly} onChangeText={(v) => patch({ foreignAmount: v })} keyboardType="decimal-pad" style={{ borderWidth: 1, padding: 8 }} />
      <TextInput placeholder="Foreign currency" value={draft.foreignCurrencyCode ?? ''} editable={!readOnly} onChangeText={(v) => patch({ foreignCurrencyCode: v })} style={{ borderWidth: 1, padding: 8 }} />

      {!readOnly && (
        <Button
          title="Confirm"
          disabled={confirming}
          onPress={async () => {
            if (confirming) return;
            setConfirming(true);
            try {
              await confirmInboxItem(db, id);
              router.back();
            } finally {
              setConfirming(false);
            }
          }}
        />
      )}
    </ScrollView>
  );
}
