// Asset accounts and the cash-envelope marker (design §6.6).
import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { eq } from 'drizzle-orm';
import { useLiveQuery } from '../../src/db/useLiveQuery';
import { useDb } from '../../src/providers/DbProvider';
import { useTheme } from '../../src/ui/theme';
import { Screen, AppBar, Card, Row, Sheet, Chip, Button } from '../../src/ui/components';
import { referenceAccounts } from '../../src/db/schema';
import { hasEnvelopeMarker, setEnvelopeMarker } from '../../src/accounts/envelopeMarker';
import { enqueueOperation } from '../../src/sync/outbox';
import { generateId } from '../../src/utils/id';

type AccountRow = typeof referenceAccounts.$inferSelect;

export default function AccountsScreen() {
  const db = useDb();
  const t = useTheme();
  const { data } = useLiveQuery(db.select().from(referenceAccounts));
  const assetAccounts = (data ?? []).filter((a) => a.type === 'asset');
  const [editing, setEditing] = useState<AccountRow | null>(null);

  async function toggleEnvelope(account: AccountRow) {
    const next = !hasEnvelopeMarker(account.notes);
    const nextNotes = setEnvelopeMarker(account.notes, next);
    await db.update(referenceAccounts).set({ notes: nextNotes }).where(eq(referenceAccounts.id, account.id));
    await enqueueOperation(db, { id: generateId(), kind: 'update_account', payload: { accountId: account.id, setEnvelopeMarker: next } });
    setEditing((cur) => (cur && cur.id === account.id ? { ...cur, notes: nextNotes } : cur));
  }

  return (
    <Screen bottom>
      <AppBar title="Accounts" />
      <FlatList
        data={assetAccounts}
        keyExtractor={(a) => a.id}
        contentContainerStyle={{ padding: t.space.lg, gap: t.space.sm }}
        renderItem={({ item }) => (
          <Card onPress={() => setEditing(item)}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
              <Text style={[t.type.body, { color: t.color.text, flex: 1 }]} numberOfLines={1}>{item.name}</Text>
              {hasEnvelopeMarker(item.notes) && <Chip label="Envelope" />}
              <Text style={[t.type.body, { color: t.color.textFaint }]}>›</Text>
            </View>
          </Card>
        )}
        ListEmptyComponent={<Text style={[t.type.body, { color: t.color.textFaint, textAlign: 'center', paddingTop: t.space.xl }]}>No asset accounts synced yet</Text>}
      />

      <Sheet
        visible={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.name ?? ''}
        footer={<Button title="Done" onPress={() => setEditing(null)} />}
      >
        {!!editing && (
          <View>
            <Row first label="Name" value={editing.name} />
            <Row label="Currency" value={editing.currencyCode} />
            <Pressable
              onPress={() => toggleEnvelope(editing)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: hasEnvelopeMarker(editing.notes) }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md, paddingVertical: t.space.md }}
            >
              <View
                style={{
                  width: 22, height: 22, borderRadius: t.radius.sm, borderWidth: 1.5,
                  borderColor: hasEnvelopeMarker(editing.notes) ? t.color.accent : t.color.border,
                  backgroundColor: hasEnvelopeMarker(editing.notes) ? t.color.accent : 'transparent',
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                {hasEnvelopeMarker(editing.notes) && <Text style={{ color: t.color.onAccent, fontSize: 14 }}>✓</Text>}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[t.type.body, { color: t.color.text }]}>Cash envelope</Text>
                <Text style={[t.type.label, { color: t.color.textMuted }]}>Counted in the cash sweep</Text>
              </View>
            </Pressable>
          </View>
        )}
      </Sheet>
    </Screen>
  );
}
