import { useTranslation } from 'react-i18next';
import { Card, ListRow, Tile } from '../ui/kit';
import { currencyOf, formatMoney } from '../money/format';
import type { ReferenceAccountRow } from '../accounts/useAssetAccounts';
import type { SweepAdjustment } from './sweep';

export interface CountOtherEnvelopesProps {
  accounts: ReferenceAccountRow[];
  counts: Record<string, string>;
  currencies: Parameters<typeof currencyOf>[0];
  invalidCounts: Set<string>;
  adjustments: SweepAdjustment[];
  onSelectAccount: (accountId: string) => void;
}

export function CountOtherEnvelopes({
  accounts,
  counts,
  currencies,
  invalidCounts,
  adjustments,
  onSelectAccount,
}: CountOtherEnvelopesProps) {
  const { t: tr } = useTranslation();

  if (accounts.length === 0) return null;

  return (
    <Card flush>
      {accounts.map((a, index) => {
        const currency = currencyOf(currencies, a.currencyCode);
        const counted = counts[a.id];
        const invalid = invalidCounts.has(a.id);
        const adjustment = adjustments.find((adj) => adj.accountId === a.id);
        const hasCounted = counted !== undefined && counted.trim() !== '';
        const matches = hasCounted && !invalid && !adjustment;

        let sub: string;
        let action: { label: string; onPress: () => void; pill?: boolean } | undefined;
        let value: string | undefined;

        if (hasCounted) {
          if (matches) {
            sub = tr('count.matches', {
              amount: a.currentBalance ? formatMoney(a.currentBalance, currency) : '—',
            });
          } else if (adjustment) {
            sub = tr('count.reviewAdjustmentSub', {
              counted: formatMoney(counted, currency),
              expected: a.currentBalance ? formatMoney(a.currentBalance, currency) : '—',
            });
            value =
              (adjustment.type === 'withdrawal' ? '−' : '+') +
              formatMoney(adjustment.amount, currency);
          } else {
            sub = tr('count.expected', {
              amount: a.currentBalance ? formatMoney(a.currentBalance, currency) : '—',
            });
          }
        } else {
          sub = tr('count.skipped', {
            amount: a.currentBalance ? formatMoney(a.currentBalance, currency) : '—',
          });
          action = {
            label: tr('count.countAction'),
            onPress: () => onSelectAccount(a.id),
            pill: true,
          };
        }

        return (
          <ListRow
            key={a.id}
            first={index === 0}
            leading={<Tile icon="wallet-outline" tone="warn" size={32} />}
            label={a.name}
            sub={sub}
            value={value}
            action={action}
            chevron={!action}
            onPress={() => onSelectAccount(a.id)}
          />
        );
      })}
    </Card>
  );
}
