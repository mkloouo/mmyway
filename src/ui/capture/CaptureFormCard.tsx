import { useTranslation } from 'react-i18next';
import { View, Text } from 'react-native';
import { Card, Chip } from '../kit';
import { useTheme } from '../theme';
import { TextField } from '../TextField';
import { FieldRow, AccountFieldRow } from './CaptureRows';
import { CaptureCategoryBudgetRow } from './CaptureCategoryBudgetRow';
import type { MerchantHistory } from '../../lookup/merchantLookup';
import type { AccountPickerAccount } from '../../accounts/useAssetAccounts';
import type { DisplayCurrency } from '../../money/format';

export interface CaptureFormCardProps {
  type: 'withdrawal' | 'deposit' | 'transfer';
  description: string;
  onChangeDescription: (val: string) => void;
  isPayeeType: boolean;
  merchantRawInput: string;
  rankedPayees: MerchantHistory[];
  onOpenPayeeSheet: () => void;
  onApplyPayeeHistory: (h: MerchantHistory) => void;
  blocks: (missing: string) => boolean;
  recentAccounts: AccountPickerAccount[];
  effectiveSourceId: string | null;
  destinationId: string | null;
  onOpenSourceAccountSheet: () => void;
  onOpenDestinationAccountSheet: () => void;
  onSelectSourceAccount: (id: string) => void;
  onSelectDestinationAccount: (id: string) => void;
  categoryName: string | null;
  budget: { id: string; name: string } | undefined;
  envelopesOn: boolean;
  envelopeLeft: string | null;
  currency: DisplayCurrency;
  onOpenCategorySheet: () => void;
  onOpenBudgetSheet: () => void;
}

export function CaptureFormCard({
  type,
  description,
  onChangeDescription,
  isPayeeType,
  merchantRawInput,
  rankedPayees,
  onOpenPayeeSheet,
  onApplyPayeeHistory,
  blocks,
  recentAccounts,
  effectiveSourceId,
  destinationId,
  onOpenSourceAccountSheet,
  onOpenDestinationAccountSheet,
  onSelectSourceAccount,
  onSelectDestinationAccount,
  categoryName,
  budget,
  envelopesOn,
  envelopeLeft,
  currency,
  onOpenCategorySheet,
  onOpenBudgetSheet,
}: CaptureFormCardProps) {
  const t = useTheme();
  const { t: tr } = useTranslation();

  return (
    <Card flush style={{ marginHorizontal: t.space.lg }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          minHeight: 48,
          paddingHorizontal: t.space.lg,
          gap: t.space.sm,
        }}
      >
        <Text style={[t.type.label, { width: 58, color: t.color.textFaint }]}>
          {tr('fields.description')}
        </Text>
        <TextField
          testID="capture-title"
          accessibilityLabel={tr('fields.description')}
          value={description}
          onChangeText={onChangeDescription}
          returnKeyType="done"
          style={[
            t.type.body,
            {
              flex: 1,
              minWidth: 0,
              borderWidth: 0,
              paddingHorizontal: 0,
              backgroundColor: 'transparent',
            },
          ]}
        />
      </View>

      {isPayeeType && (
        <FieldRow
          label={type === 'deposit' ? tr('capture.payer') : tr('capture.payee')}
          blocking={blocks('payee')}
          searchLabel={
            type === 'deposit' ? tr('payeeSheet.payer.search') : tr('payeeSheet.payee.search')
          }
          onSearch={onOpenPayeeSheet}
        >
          {!!merchantRawInput && !rankedPayees.some((h) => h.displayName === merchantRawInput) && (
            <Chip label={merchantRawInput} selected onPress={onOpenPayeeSheet} />
          )}
          {rankedPayees.map((h) => (
            <Chip
              key={h.merchantKey}
              label={h.displayName}
              selected={merchantRawInput === h.displayName}
              onPress={() => onApplyPayeeHistory(h)}
            />
          ))}
        </FieldRow>
      )}

      {type === 'transfer' ? (
        <>
          <AccountFieldRow
            label={tr('fields.from')}
            searchLabel={tr('capture.searchSourceAccounts')}
            accounts={recentAccounts}
            selectedId={effectiveSourceId}
            blocking={blocks('source account')}
            onSearch={onOpenSourceAccountSheet}
            onSelect={onSelectSourceAccount}
          />
          <AccountFieldRow
            label={tr('fields.to')}
            searchLabel={tr('capture.searchDestinationAccounts')}
            accounts={recentAccounts.filter((a) => a.id !== effectiveSourceId)}
            selectedId={destinationId}
            blocking={blocks('destination account')}
            onSearch={onOpenDestinationAccountSheet}
            onSelect={onSelectDestinationAccount}
          />
        </>
      ) : (
        <AccountFieldRow
          label={type === 'deposit' ? tr('fields.to') : tr('fields.from')}
          searchLabel={tr('pickers.searchAccounts')}
          accounts={recentAccounts}
          selectedId={type === 'withdrawal' ? effectiveSourceId : destinationId}
          blocking={blocks(type === 'deposit' ? 'destination account' : 'source account')}
          onSearch={
            type === 'withdrawal' ? onOpenSourceAccountSheet : onOpenDestinationAccountSheet
          }
          onSelect={type === 'withdrawal' ? onSelectSourceAccount : onSelectDestinationAccount}
        />
      )}

      {type !== 'transfer' && (
        <CaptureCategoryBudgetRow
          categoryName={categoryName}
          budget={budget}
          envelopesOn={envelopesOn}
          envelopeLeft={envelopeLeft}
          currency={currency}
          onOpenCategory={onOpenCategorySheet}
          onOpenBudget={onOpenBudgetSheet}
        />
      )}
    </Card>
  );
}
