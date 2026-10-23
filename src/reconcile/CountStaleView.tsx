import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';
import { Button, Card, ListRow, NoticeBlock, SCREEN_TOP_PADDING, StickyFooter } from '../ui/kit';
import { useTheme } from '../ui/theme';
import { currencyOf, formatMoney } from '../money/format';
import { relativeTime } from '../ui/relativeTime';
import { describeCountBlocker, type CountBlocker } from './countReadiness';
import type { ReferenceAccountRow } from '../accounts/useAssetAccounts';

export function CountStaleView({
  accounts,
  currencies,
  oldestBalanceDate,
  blocker,
  syncing,
  onSync,
  keyboardHeight,
}: {
  accounts: ReferenceAccountRow[];
  currencies: Parameters<typeof currencyOf>[0];
  oldestBalanceDate: string | null;
  blocker: CountBlocker | null;
  syncing: boolean;
  onSync: () => void;
  keyboardHeight: number;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();

  const title = blocker
    ? tr('count.outOfDateTitle')
    : tr('count.staleTitle', { relative: relativeTime(oldestBalanceDate) });
  const body = blocker ? describeCountBlocker(blocker) : tr('count.staleBody');

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: t.space.lg,
          paddingTop: SCREEN_TOP_PADDING,
          gap: t.space.md,
          paddingBottom: t.space.lg + keyboardHeight,
        }}
      >
        <NoticeBlock
          title={title}
          body={body}
          tone="warn"
          action={{
            label: syncing ? tr('sync.syncing') : tr('sync.syncNow'),
            onPress: onSync,
            disabled: syncing,
          }}
        />

        <View accessibilityState={{ disabled: true }}>
          <Card flush style={{ opacity: 0.5 }}>
            {accounts.map((a, index) => {
              const currency = currencyOf(currencies, a.currencyCode);
              const amount = a.currentBalance ? formatMoney(a.currentBalance, currency) : '—';
              return (
                <ListRow
                  key={a.id}
                  first={index === 0}
                  label={a.name}
                  sub={tr('count.expected', { amount })}
                />
              );
            })}
          </Card>
        </View>
      </ScrollView>

      <StickyFooter>
        <View style={{ flex: 1, gap: t.space.xs }}>
          <Text style={[t.type.label, { color: t.color.textMuted }]}>
            {tr('count.waitingSync')}
          </Text>
          <Button title={tr('count.syncFirst')} disabled size="lg" />
        </View>
      </StickyFooter>
    </View>
  );
}
