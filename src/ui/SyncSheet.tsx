// Everything the old grey box on Inbox showed, moved behind the sync pill (design §6.1).
import { Text, View } from 'react-native';
import { Sheet, Row, Button } from './components';
import { useTheme } from './theme';
import type { SyncSummary } from '../sync/runSync';

export function SyncSheet({
  visible, onClose, summary, status, pendingOutboxCount, onSyncNow,
}: {
  visible: boolean;
  onClose: () => void;
  summary: SyncSummary | null;
  status: 'idle' | 'syncing' | 'error';
  pendingOutboxCount: number;
  onSyncNow: () => void;
}) {
  const t = useTheme();
  const syncing = status === 'syncing';
  const signedIn = summary?.signedIn ?? false;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Sync"
      footer={<Button title={syncing ? 'Syncing…' : 'Sync now'} onPress={onSyncNow} disabled={syncing} />}
    >
      <View>
        <Row
          first
          label="Firefly III"
          value={!signedIn ? 'not signed in' : summary?.ff3Reachable ? 'reachable' : 'unreachable'}
          tone={!signedIn || !summary?.ff3Reachable ? 'warn' : 'default'}
        />
        {Object.entries(summary?.providersReachable ?? {}).map(([name, ok]) => (
          <Row key={name} label={name} value={ok ? 'up' : 'down'} tone={ok ? 'default' : 'warn'} />
        ))}
        {Object.keys(summary?.providersReachable ?? {}).length === 0 && (
          <Row label="Receipt providers" value="none configured" tone="warn" />
        )}
        <Row label="Pending outbox" value={String(pendingOutboxCount)} tone={pendingOutboxCount > 0 ? 'warn' : 'default'} />
        <Row label="Last synced" value={summary?.lastSyncedAt ?? 'never'} />
        {!!summary?.error && (
          <Text style={[t.type.label, { color: t.color.danger, paddingTop: t.space.sm }]}>{summary.error}</Text>
        )}
      </View>
    </Sheet>
  );
}
