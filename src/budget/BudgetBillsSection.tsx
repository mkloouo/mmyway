// Due this month section in the Budget tab (Board 01).
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import type { DisplayCurrency } from '../money/format';
import type { BillDue } from '../sync/bucketData';
import { Button, Card, DateTile, ListRow, Money, SectionHeader } from '../ui/kit';
import { useTheme } from '../ui/theme';

export function BudgetBillsSection({
  bills,
  currency,
}: {
  bills: BillDue[];
  currency: DisplayCurrency;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();

  if (bills.length === 0) return null;

  return (
    <>
      <SectionHeader
        title={tr('budget.dueThisPeriod')}
        action={
          <Button
            title={tr('budget.planned')}
            variant="ghost"
            size="bar"
            onPress={() => router.navigate('/(tabs)/planned')}
          />
        }
      />
      <Card flush style={{ marginHorizontal: t.space.lg }}>
        {bills.map((bill, index) => (
          <ListRow
            key={bill.billId}
            first={index === 0}
            leading={<DateTile date={bill.date} mode="month" />}
            label={bill.name}
            trailing={
              <Money
                amount={bill.amount.startsWith('-') ? bill.amount : `-${bill.amount}`}
                currency={currency}
                size="heading"
              />
            }
            onPress={() => router.navigate('/(tabs)/planned')}
          />
        ))}
      </Card>
    </>
  );
}
