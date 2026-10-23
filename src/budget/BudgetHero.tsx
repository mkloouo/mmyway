// Ready to assign hero with 3-column stats and Assign money / Auto-fill actions (Board 01).
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { AutofillPlan } from '../bucket/autofill';
import { autofillIsEmpty } from '../bucket/autofill';
import type { Rta } from '../bucket/rta';
import { formatMoney, type DisplayCurrency } from '../money/format';
import { Hero, Money } from '../ui/kit';
import { useTheme } from '../ui/theme';

export function BudgetHero({
  rta,
  currency,
  totalSpent,
  plan,
  onInfoPress,
  onAssignMoney,
  onAutofill,
  isAutofillPending,
}: {
  rta: Rta;
  currency: DisplayCurrency;
  totalSpent: string;
  plan: AutofillPlan;
  onInfoPress: () => void;
  onAssignMoney: () => void;
  onAutofill: () => void;
  isAutofillPending: boolean;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();

  const unsigned = (amount: string) => formatMoney(amount.replace(/^[-−]/, ''), currency);

  return (
    <View style={{ paddingHorizontal: t.space.lg }}>
      <Hero
        caption={tr('budget.readyToAssign')}
        onInfoPress={onInfoPress}
        infoAccessibilityLabel={tr('budget.howRtaTitle')}
        amount={
          <Money
            amount={rta.readyToAssign}
            currency={currency}
            size="display"
            tone={rta.readyToAssign.startsWith('-') ? 'warn' : undefined}
          />
        }
        stats={[
          { label: tr('budget.statInAccounts'), value: unsigned(rta.cash) },
          { label: tr('budget.statAssigned'), value: unsigned(rta.allocated) },
          { label: tr('budget.statSpent'), value: unsigned(totalSpent) },
        ]}
        primaryAction={{
          label: tr('budget.assignMoney'),
          onPress: onAssignMoney,
        }}
        secondaryAction={
          !autofillIsEmpty(plan)
            ? {
                label: tr('budget.autofillWith', { amount: formatMoney(plan.total, currency) }),
                onPress: onAutofill,
                disabled: isAutofillPending,
              }
            : undefined
        }
      />
    </View>
  );
}
