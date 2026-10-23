import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';
import { Button, Card, GroupFooter, ListRow, SectionHeader, Sheet, Tile } from '../ui/kit';
import { useTheme } from '../ui/theme';
import { currencyOf, formatMoney } from '../money/format';
import type { ReferenceAccountRow } from '../accounts/useAssetAccounts';
import type { SweepAdjustment } from './sweep';
import type { AccountPickerAccount } from '../ui/AccountPickerSheet';

export interface ReviewAdjustmentsSheetProps {
  visible: boolean;
  onClose: () => void;
  adjustments: SweepAdjustment[];
  accounts: ReferenceAccountRow[];
  currencies: Parameters<typeof currencyOf>[0];
  counts: Record<string, string>;
  effectiveShortfall: AccountPickerAccount | null;
  effectiveSurplus: AccountPickerAccount | null;
  reconcileCategory: string | null;
  onOpenShortfall: () => void;
  onOpenSurplus: () => void;
  onOpenCategory: () => void;
  onConfirm: () => void;
  confirming: boolean;
  canCount: boolean;
}

export function ReviewAdjustmentsSheet({
  visible,
  onClose,
  adjustments,
  accounts,
  currencies,
  counts,
  effectiveShortfall,
  effectiveSurplus,
  reconcileCategory,
  onOpenShortfall,
  onOpenSurplus,
  onOpenCategory,
  onConfirm,
  confirming,
  canCount,
}: ReviewAdjustmentsSheetProps) {
  const t = useTheme();
  const { t: tr } = useTranslation();

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={tr('count.reviewTitle')}
      footer={
        <Button
          title={
            confirming
              ? tr('draft.confirming')
              : tr('count.confirmAdjustment', { count: adjustments.length })
          }
          onPress={onConfirm}
          disabled={confirming || !canCount}
          size="lg"
        />
      }
    >
      <Card flush>
        {adjustments.map((a, index) => {
          const account = accounts.find((acc) => acc.id === a.accountId);
          const currency = currencyOf(currencies, a.currencyCode);
          const withdrawal = a.type === 'withdrawal';
          const counted = counts[a.accountId] ?? '0';
          const expected = account?.currentBalance ?? '0';
          return (
            <ListRow
              key={a.accountId}
              first={index === 0}
              leading={<Tile icon="wallet-outline" tone="warn" size={32} />}
              label={account?.name ?? a.accountId}
              sub={tr('count.reviewAdjustmentSub', {
                counted: formatMoney(counted, currency),
                expected: formatMoney(expected, currency),
              })}
              trailing={
                <Text
                  style={[
                    t.type.amount,
                    {
                      color: withdrawal ? t.color.warnStrong : t.color.income,
                      fontWeight: '600',
                    },
                  ]}
                >
                  {withdrawal ? '−' : '+'}
                  {formatMoney(a.amount, currency)}
                </Text>
              }
            />
          );
        })}
      </Card>

      <SectionHeader title={tr('count.bookedAs')} />
      <Card flush>
        <ListRow
          first
          label={tr('count.missingCashTitle')}
          sub={tr('count.expenseAccountSub')}
          value={effectiveShortfall?.name ?? tr('count.defaultPayeeShortfall')}
          chevron
          onPress={onOpenShortfall}
        />
        <ListRow
          label={tr('count.extraCashTitle')}
          sub={tr('count.revenueAccountSub')}
          value={effectiveSurplus?.name ?? tr('count.defaultPayeeSurplus')}
          chevron
          onPress={onOpenSurplus}
        />
        <ListRow
          label={tr('fields.category')}
          value={reconcileCategory ?? tr('common.none')}
          chevron
          onPress={onOpenCategory}
        />
      </Card>
      <GroupFooter>{tr('count.reviewFootnote')}</GroupFooter>
    </Sheet>
  );
}
