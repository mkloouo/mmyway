import { useState } from 'react';
import { View, Text, Button, FlatList, Switch } from 'react-native';
import { router, Link } from 'expo-router';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useDb } from '../src/providers/DbProvider';
import { useInboxItems } from '../src/inbox/useInboxItems';
import { outboxOperations } from '../src/db/schema';
import { useSync } from '../src/sync/useSync';
import { confirmInboxItem } from '../src/inbox/createManualEntry';

const CONFIRMABLE_STATES = new Set(['captured', 'parsed']);

export default function InboxScreen() {
  const db = useDb();
  const { data: items } = useInboxItems();
  const { data: outbox } = useLiveQuery(db.select().from(outboxOperations));
  const { summary, status, syncNow } = useSync();
  const pendingCount = (outbox ?? []).filter((row) => row.status === 'pending' || row.status === 'failed').length;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function confirmSelected() {
    if (confirming || selected.size === 0) return;
    setConfirming(true);
    try {
      for (const id of selected) await confirmInboxItem(db, id);
      setSelected(new Set());
    } finally {
      setConfirming(false);
    }
  }

  return (
    <View style={{ flex: 1, padding: 16, gap: 8 }}>
      <Text style={{ fontSize: 20, fontWeight: 'bold' }}>Inbox</Text>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Link href="/entry">Capture</Link>
        <Link href="/receipt">Receipt</Link>
        <Link href="/transactions">Transactions</Link>
        <Link href="/recurring">Recurring</Link>
        <Link href="/settings">Settings</Link>
        <Link href="/settings/aliases">Aliases</Link>
      </View>

      <View style={{ borderWidth: 1, borderColor: '#ddd', padding: 8, gap: 2 }}>
        <Text>FF3: {!summary ? '…' : summary.signedIn ? (summary.ff3Reachable ? 'reachable' : 'unreachable') : 'not signed in'}</Text>
        <Text>
          Providers: {summary && Object.keys(summary.providersReachable).length > 0
            ? Object.entries(summary.providersReachable).map(([name, ok]) => `${name}: ${ok ? 'up' : 'down'}`).join(', ')
            : 'none configured'}
        </Text>
        <Text>Pending outbox: {pendingCount}</Text>
        <Text>Last synced: {summary?.lastSyncedAt ?? 'never'}</Text>
        {summary?.error && <Text style={{ color: 'red' }}>Sync error: {summary.error}</Text>}
        <Button title={status === 'syncing' ? 'Syncing…' : 'Sync now'} onPress={() => syncNow()} disabled={status === 'syncing'} />
      </View>
      <Button title={confirming ? 'Confirming…' : `Confirm selected (${selected.size})`} onPress={confirmSelected} disabled={confirming || selected.size === 0} />
      <FlatList
        data={items ?? []}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderColor: '#ddd' }}>
            {CONFIRMABLE_STATES.has(item.state) && (
              <Switch value={selected.has(item.id)} onValueChange={() => toggle(item.id)} />
            )}
            <Text onPress={() => router.push(`/draft/${item.id}`)}>
              {item.kind} · {item.state}
            </Text>
          </View>
        )}
      />
    </View>
  );
}
