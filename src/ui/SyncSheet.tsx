// Everything the old grey box on Inbox showed, moved behind the sync pill (design §6.1), now
// listing every configured address with its own dot (§6.6) — "why is it offline" is answerable
// here without opening Settings.
import { Pressable, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Button, Card, Dot, Sheet } from './kit';
import { useTheme } from './theme';
import type { SyncSummary } from '../sync/runSync';
import { describeSyncTime } from './relativeTime';

const PROVIDER_LABEL_KEYS: Record<string, string> = {
  local: 'sync.providerLocal',
  gemini: 'sync.providerGemini',
};

function StatusRow({
  statusColor,
  title,
  subtitle,
  trailing,
  first,
}: {
  statusColor: string;
  title: string;
  subtitle: string;
  trailing?: React.ReactNode;
  first?: boolean;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 52,
        paddingHorizontal: 16,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: t.color.border,
      }}
    >
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: statusColor,
        }}
      />
      <View style={{ flex: 1, paddingVertical: 10 }}>
        <Text style={[t.type.body, { color: t.color.text }]}>{title}</Text>
        <Text style={[t.type.label, { color: t.color.textMuted }]}>{subtitle}</Text>
      </View>
      {trailing}
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
  const router = useRouter();
  const syncing = status === 'syncing';
  const signedIn = summary?.signedIn ?? false;
  const configured = (summary?.configuredProviders ?? []).length > 0;

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
      <Card flush>
        {/* Row 1: Firefly III */}
        <StatusRow
          first
          statusColor={signedIn && summary?.ff3.winner ? t.color.income : t.color.warn}
          title={
            !signedIn
              ? tr('sync.notSignedIn')
              : summary?.ff3.winner
                ? tr('sync.ff3Reachable')
                : tr('sync.ff3Unreachable')
          }
          subtitle={
            !signedIn
              ? tr('sync.notSignedInValue')
              : (summary?.ff3.winner ?? summary?.ff3.results[0]?.address ?? '')
          }
          trailing={
            summary?.ff3.winner ? (
              <Text style={[t.type.label, { color: t.color.accent }]}>{tr('addresses.inUse')}</Text>
            ) : undefined
          }
        />
        {signedIn &&
          !!summary?.ff3.results &&
          summary.ff3.results.length > 1 &&
          summary.ff3.results.map((r) => (
            <View
              key={r.address}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingHorizontal: 16,
                paddingLeft: 36,
                paddingBottom: 8,
              }}
            >
              <Dot color={r.ok ? t.color.income : t.color.textFaint} />
              <Text style={[t.type.label, { color: t.color.textMuted, flex: 1 }]} numberOfLines={1}>
                {r.address}
              </Text>
              {summary.ff3.winner === r.address && (
                <Text style={[t.type.label, { color: t.color.accent }]}>
                  {tr('addresses.inUse')}
                </Text>
              )}
            </View>
          ))}

        {/* Row 2: Receipt Reading */}
        <StatusRow
          statusColor={configured ? t.color.income : t.color.warn}
          title={configured ? tr('sync.receiptReadingConfigured') : tr('sync.receiptReadingOff')}
          subtitle={
            configured
              ? summary!.configuredProviders
                  .map((p) => (PROVIDER_LABEL_KEYS[p] ? tr(PROVIDER_LABEL_KEYS[p]) : p))
                  .join(', ')
              : tr('sync.receiptReadingNoKeys')
          }
          trailing={
            !configured ? (
              <Pressable
                onPress={() => {
                  onClose();
                  router.push('/settings/receipts');
                }}
                hitSlop={8}
              >
                <Text style={[t.type.body, { color: t.color.accent, fontWeight: '600' }]}>
                  {tr('sync.setUp')}
                </Text>
              </Pressable>
            ) : undefined
          }
        />

        {/* Row 3: Outbox Status */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            minHeight: 52,
            paddingHorizontal: 16,
            borderTopWidth: 1,
            borderTopColor: t.color.border,
          }}
        >
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: pendingOutboxCount === 0 ? t.color.income : t.color.warn,
            }}
          />
          <Text style={[t.type.body, { color: t.color.text, flex: 1 }]}>
            {pendingOutboxCount === 0
              ? tr('sync.nothingWaiting')
              : tr('sync.waitingToSend', { count: pendingOutboxCount })}
          </Text>
        </View>

        {/* Row 4: Last synced */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            minHeight: 52,
            paddingHorizontal: 16,
            borderTopWidth: 1,
            borderTopColor: t.color.border,
          }}
        >
          <View style={{ width: 8 }} />
          <Text style={[t.type.body, { color: t.color.text, flex: 1 }]}>
            {tr('sync.lastSynced')}
          </Text>
          <Text
            style={[t.type.body, { color: t.color.textMuted, flexShrink: 0 }]}
            numberOfLines={1}
          >
            {describeSyncTime(summary?.lastSyncedAt).replace(/ /g, '\u00A0')}
          </Text>
        </View>
      </Card>
      {!!summary?.error && (
        <Text
          style={[
            t.type.label,
            { color: t.color.danger, paddingTop: t.space.sm, paddingHorizontal: 4 },
          ]}
        >
          {summary.error}
        </Text>
      )}
    </Sheet>
  );
}
