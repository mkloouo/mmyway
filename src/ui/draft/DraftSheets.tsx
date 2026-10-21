import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Button, Card, ListRow, Sheet } from '../kit';
import { useTheme } from '../theme';
import { AmountSheet } from '../AmountSheet';
import { TextField } from '../TextField';
import { PayeeSheet } from '../PayeeSheet';
import { AllocationSheet, type AllocationMode, type AllocationResult } from '../AllocationSheet';
import { PickerSheet } from '../PickerSheet';
import { PhotoViewer } from '../PhotoViewer';
import { Snackbar, type SnackbarEntry } from '../Snackbar';
import { pickableCurrencies } from '../../money/currencies';
import { navigateOnce } from '../navigateOnce';
import type { DisplayCurrency } from '../../money/format';
import type { MerchantHistory } from '../../lookup/merchantLookup';
import type { CurrencyRow } from '../../money/currencies';
import type { Draft } from '../../inbox/draft';

export interface DraftSheetsProps {
  sheet: 'payee' | 'menu' | 'photo' | 'currency' | null;
  onCloseSheet: () => void;
  onOpenSheet: (sheet: 'payee' | 'menu' | 'photo' | 'currency') => void;
  readOnly?: boolean;
  rowFf3GroupId?: string | null;
  receiptImagePath?: string | null;
  draft: Draft;
  amounts: string[];
  total: string;
  currency: DisplayCurrency;
  accountCurrency: DisplayCurrency;
  currencies: CurrencyRow[];
  currenciesLoading?: boolean;
  chargedLabel: string;
  histories: MerchantHistory[];
  keypadFor: number | 'total' | 'foreign' | null;
  onCommitKeypad: (val: string | null) => void;
  textFor: number | 'title' | null;
  onCloseText: () => void;
  textField: { value: string; onChange: (val: string) => void };
  extraPayeeFor: number | null;
  onCloseExtraPayee: () => void;
  onSelectExtraPayee: (name: string, isNew: boolean) => void;
  allocation: AllocationMode | null;
  onCloseAllocation: () => void;
  onAllocated: (result: AllocationResult) => void;
  onStartSplit: () => void;
  onSelectCurrency: (code: string) => void;
  onAttachPhoto: () => void;
  onDeleteDraft: () => void;
  onRemovePhoto: () => void;
  onChoosePayee: (d: Draft, name: string, isNew: boolean) => void;
  snackbar: SnackbarEntry | null;
  onDismissSnackbar: () => void;
}

export function DraftSheets({
  sheet,
  onCloseSheet,
  onOpenSheet,
  readOnly,
  rowFf3GroupId,
  receiptImagePath,
  draft,
  amounts,
  total,
  currency,
  accountCurrency,
  currencies,
  currenciesLoading,
  chargedLabel,
  histories,
  keypadFor,
  onCommitKeypad,
  textFor,
  onCloseText,
  textField,
  extraPayeeFor,
  onCloseExtraPayee,
  onSelectExtraPayee,
  allocation,
  onCloseAllocation,
  onAllocated,
  onStartSplit,
  onSelectCurrency,
  onAttachPhoto,
  onDeleteDraft,
  onRemovePhoto,
  onChoosePayee,
  snackbar,
  onDismissSnackbar,
}: DraftSheetsProps) {
  const t = useTheme();
  const { t: tr } = useTranslation();

  const keypadValue =
    keypadFor === 'total'
      ? total
      : keypadFor === 'foreign'
        ? (draft.foreignAmount ?? '0')
        : typeof keypadFor === 'number'
          ? (amounts[keypadFor] ?? '0')
          : draft.amount;

  return (
    <>
      <AmountSheet
        visible={keypadFor !== null}
        title={
          keypadFor === 'total'
            ? tr('splits.total')
            : keypadFor === 'foreign'
              ? chargedLabel
              : tr('fields.amount')
        }
        initial={keypadValue}
        currency={keypadFor === 'foreign' ? accountCurrency : currency}
        type={draft.type}
        loading={currenciesLoading}
        onDone={onCommitKeypad}
      />

      <Sheet
        visible={textFor !== null}
        onClose={onCloseText}
        title={textFor === 'title' ? tr('splits.title') : tr('fields.description')}
        footer={<Button title={tr('common.done')} onPress={onCloseText} />}
      >
        <TextField value={textField.value} onCommit={textField.onChange} autoFocus />
      </Sheet>

      <PayeeSheet
        visible={sheet === 'payee'}
        onClose={onCloseSheet}
        histories={histories}
        payeeLabel={draft.type === 'deposit' ? 'payer' : 'payee'}
        onSelect={(h) => {
          onChoosePayee(draft, h.displayName, false);
        }}
        onCreateNew={(text) => {
          onChoosePayee(draft, text, true);
        }}
      />

      <PayeeSheet
        visible={extraPayeeFor !== null}
        onClose={onCloseExtraPayee}
        histories={histories}
        payeeLabel={draft.type === 'deposit' ? 'payer' : 'payee'}
        onSelect={(h) => {
          onSelectExtraPayee(h.displayName, false);
        }}
        onCreateNew={(text) => {
          onSelectExtraPayee(text, true);
        }}
      />

      {!!allocation && (
        <AllocationSheet
          mode={allocation}
          amounts={amounts}
          labels={amounts.map((_, i) => {
            const category =
              i === 0 ? draft.categoryName : draft.extraSplits?.[i - 1]?.categoryName;
            return (
              tr('splits.position', { index: i + 1, count: amounts.length }) +
              (category ? ` · ${category}` : '')
            );
          })}
          currency={currency}
          type={draft.type}
          onDone={onAllocated}
          onClose={onCloseAllocation}
        />
      )}

      <Sheet visible={sheet === 'menu'} onClose={onCloseSheet} title={tr('draft.menuTitle')}>
        <View style={{ gap: t.space.lg, paddingBottom: t.space.lg }}>
          <Card flush>
            {readOnly && !!rowFf3GroupId && (
              <ListRow
                first
                label={tr('draft.openInActivity')}
                chevron
                onPress={() => {
                  onCloseSheet();
                  navigateOnce(`/transactions/${rowFf3GroupId}`);
                }}
              />
            )}
            {!readOnly && (
              <ListRow
                first
                label={tr('splits.splitIntoParts')}
                chevron
                onPress={() => {
                  onCloseSheet();
                  onStartSplit();
                }}
              />
            )}
            {!readOnly && (
              <ListRow
                first={readOnly && !rowFf3GroupId}
                label={tr('fields.currency')}
                value={draft.currencyCode || '—'}
                chevron
                onPress={() => onOpenSheet('currency')}
              />
            )}
            {!readOnly && !!receiptImagePath && (
              <ListRow
                label={tr('draft.replacePhoto')}
                chevron
                onPress={() => {
                  onCloseSheet();
                  onAttachPhoto();
                }}
              />
            )}
          </Card>
          <Card flush>
            <ListRow first label={tr('draft.deleteDraft')} tone="danger" onPress={onDeleteDraft} />
          </Card>
        </View>
      </Sheet>

      <PickerSheet
        visible={sheet === 'currency'}
        onClose={onCloseSheet}
        title={tr('fields.currency')}
        options={pickableCurrencies(currencies, draft.currencyCode).map((c) => ({
          key: c.code,
          label: c.code,
        }))}
        selected={draft.currencyCode}
        onSelect={(code) => code && onSelectCurrency(code)}
      />

      <Snackbar entry={snackbar} onDismiss={onDismissSnackbar} />

      <PhotoViewer
        uri={sheet === 'photo' ? (receiptImagePath ?? null) : null}
        onClose={onCloseSheet}
        onDelete={readOnly ? undefined : onRemovePhoto}
      />
    </>
  );
}
