// Everything the old grey box on Inbox showed, moved behind the sync pill (design §6.1), now
// listing every configured address with its own dot (§6.6) — "why is it offline" is answerable
// here without opening Settings.
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Sheet, Row, Button } from './components';
import { useTheme } from './theme';
import type { SyncSummary } from '../sync/runSync';
import type { ServerReachability } from '../sync/reachability';
import { describeSyncTime } from './relativeTime';

const PROVIDER_LABEL_KEYS: Record<string, string> = {
  local: 'sync.providerLocal',
  gemini: 'sync.providerGemini',
};

function AddressRows({ label, report }: { label: string; report: ServerReachability }) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  if (report.results.length === 0) {
    return <Row label={label} value={tr('sync.noneConfigured')} tone="warn" />;
  }
  return (
    <View>
      <Row
        label={label}
        value={report.winner ? tr('sync.reachable') : tr('sync.unreachable')}
        tone={report.winner ? 'default' : 'warn'}
      />
      {report.results.map((r) => (
        <View
          key={r.address}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: t.space.sm,
            paddingLeft: t.space.lg,
            paddingVertical: t.space.xs,
          }}
        >
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: r.ok ? t.color.income : t.color.textFaint,
            }}
          />
          <Text style={[t.type.label, { color: t.color.textMuted, flex: 1 }]} numberOfLines={1}>
            {r.address}
          </Text>
          {report.winner === r.address && (
            <Text style={[t.type.label, { color: t.color.accent }]}>{tr('addresses.inUse')}</Text>
          )}
        </View>
      ))}
    </View>
  );
}

export function SyncSheet({
  visible,
  onClose,
  summary,
  status,
  pendingOutboxCount,
  onSyncNow,
}: {
  visible: boolean;
  onClose: () => void;
  summary: SyncSummary | null;
  status: 'idle' | 'syncing' | 'error';
  pendingOutboxCount: number;
  onSyncNow: () => void;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const syncing = status === 'syncing';
  const signedIn = summary?.signedIn ?? false;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={tr('sync.title')}
      footer={
        <Button
          title={syncing ? tr('sync.syncing') : tr('sync.syncNow')}
          onPress={onSyncNow}
          disabled={syncing}
        />
      }
    >
      <View>
        {!signedIn ? (
          <Row first label="Firefly III" value={tr('sync.notSignedInValue')} tone="warn" />
        ) : (
          <AddressRows label="Firefly III" report={summary!.ff3} />
        )}
        {/* A probed provider (the local model, on a full sync) shows its addresses; one that isn't
            probed — Gemini has no address, and a push sync skips the probe — just shows it's set. */}
        {(summary?.configuredProviders ?? []).map((name) => {
          const report = summary?.providers[name];
          const label = PROVIDER_LABEL_KEYS[name] ? tr(PROVIDER_LABEL_KEYS[name]) : name;
          return report ? (
            <AddressRows key={name} label={label} report={report} />
          ) : (
            <Row key={name} label={label} value={tr('sync.configured')} />
          );
        })}
        {signedIn && (summary?.configuredProviders ?? []).length === 0 && (
          <Row label={tr('sync.receiptProviders')} value={tr('sync.noneConfigured')} tone="warn" />
        )}
        <Row
          label={tr('sync.pendingOutbox')}
          value={String(pendingOutboxCount)}
          tone={pendingOutboxCount > 0 ? 'warn' : 'default'}
        />
        <Row label={tr('sync.lastSynced')} value={describeSyncTime(summary?.lastSyncedAt)} />
        {!!summary?.error && (
          <Text style={[t.type.label, { color: t.color.danger, paddingTop: t.space.sm }]}>
            {summary.error}
          </Text>
        )}
      </View>
    </Sheet>
  );
}
