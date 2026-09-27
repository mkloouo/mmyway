// Everything the old grey box on Inbox showed, moved behind the sync pill (design §6.1), now
// listing every configured address with its own dot (§6.6) — "why is it offline" is answerable
// here without opening Settings.
import { Text, View } from 'react-native';
import { Sheet, Row, Button } from './components';
import { useTheme } from './theme';
import type { SyncSummary } from '../sync/runSync';
import type { ServerReachability } from '../sync/reachability';

function AddressRows({ label, report }: { label: string; report: ServerReachability }) {
  const t = useTheme();
  if (report.results.length === 0) {
    return <Row label={label} value="none configured" tone="warn" />;
  }
  return (
    <View>
      <Row label={label} value={report.winner ? 'reachable' : 'unreachable'} tone={report.winner ? 'default' : 'warn'} />
      {report.results.map((r) => (
        <View key={r.address} style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm, paddingLeft: t.space.lg, paddingVertical: t.space.xs }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: r.ok ? t.color.income : t.color.textFaint }} />
          <Text style={[t.type.label, { color: t.color.textMuted, flex: 1 }]} numberOfLines={1}>{r.address}</Text>
          {report.winner === r.address && <Text style={[t.type.label, { color: t.color.accent }]}>in use</Text>}
        </View>
      ))}
    </View>
  );
}

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
        {!signedIn ? (
          <Row first label="Firefly III" value="not signed in" tone="warn" />
        ) : (
          <AddressRows label="Firefly III" report={summary!.ff3} />
        )}
        {Object.entries(summary?.providers ?? {}).map(([name, report]) => (
          <AddressRows key={name} label={name} report={report} />
        ))}
        {signedIn && Object.keys(summary?.providers ?? {}).length === 0 && (
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
