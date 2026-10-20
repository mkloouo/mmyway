import { useTranslation } from 'react-i18next';
import { DateSheet } from '../DateSheet';
import { PickerSheet } from '../PickerSheet';
import { PayeeSheet } from '../PayeeSheet';
import { AccountPickerSheet, type AccountPickerAccount } from '../AccountPickerSheet';
import { CaptureDetailsSheet, type CaptureDetails } from './CaptureDetailsSheet';
import { pickDateTime } from '../pickDate';
import { buildEntryDate, yesterday } from '../../capture/entryDate';
import { pickableCurrencies } from '../../money/currencies';
import { formatMoney, type DisplayCurrency } from '../../money/format';
import { isNegative } from '../../api/ff3/decimal';
import type { MerchantHistory } from '../../lookup/merchantLookup';
import type { referenceCurrencies } from '../../db/schema';

type CurrencyRow = typeof referenceCurrencies.$inferSelect;

export type CaptureSheetType =
  | 'payee'
  | 'accountSource'
  | 'accountDestination'
  | 'currency'
  | 'category'
  | 'budget'
  | 'more'
  | 'date'
  | null;

export interface CaptureSheetsProps {
  sheet: CaptureSheetType;
  onClose: () => void;
  // Date
  date: Date;
  dateMode: 'today' | 'yesterday' | 'custom';
  onDateChange: (patch: { date: Date; dateMode: 'today' | 'yesterday' | 'custom' }) => void;
  // Currency
  currencies: CurrencyRow[];
  effectiveCurrencyCode: string;
  onSelectCurrency: (code: string) => void;
  // Category
  categories: { id: string; name: string }[];
  categoryName: string | null;
  onSelectCategory: (name: string | null) => void;
  // Budget
  budgets: { id: string; name: string }[];
  budgetId: string | null;
  envelopesOn: boolean;
  allEnvelopes: Map<string, string>;
  currency: DisplayCurrency;
  onSelectBudget: (id: string | null) => void;
  // Payee
  histories: MerchantHistory[];
  payeeType: 'deposit' | 'withdrawal';
  onSelectPayeeHistory: (h: MerchantHistory) => void;
  onCreateNewPayee: (name: string) => void;
  // Account
  accountSheetTarget: 'source' | 'destination' | null;
  assetAccounts: AccountPickerAccount[];
  isTransfer: boolean;
  effectiveSourceId: string | null;
  onSelectAccount: (target: 'source' | 'destination', account: AccountPickerAccount) => void;
  // Details
  notes: string;
  tags: string[];
  sharedWith: string;
  photoUri: string | null;
  recentTags: string[];
  sharedPeople: string[];
  onCommitDetails: (details: CaptureDetails) => void;
  onAttachPhoto: () => void;
  onRemovePhoto: () => void;
}

export function CaptureSheets({
  sheet,
  onClose,
  date,
  dateMode,
  onDateChange,
  currencies,
  effectiveCurrencyCode,
  onSelectCurrency,
  categories,
  categoryName,
  onSelectCategory,
  budgets,
  budgetId,
  envelopesOn,
  allEnvelopes,
  currency,
  onSelectBudget,
  histories,
  payeeType,
  onSelectPayeeHistory,
  onCreateNewPayee,
  accountSheetTarget,
  assetAccounts,
  isTransfer,
  effectiveSourceId,
  onSelectAccount,
  notes,
  tags,
  sharedWith,
  photoUri,
  recentTags,
  sharedPeople,
  onCommitDetails,
  onAttachPhoto,
  onRemovePhoto,
}: CaptureSheetsProps) {
  const { t: tr } = useTranslation();

  return (
    <>
      <DateSheet
        visible={sheet === 'date'}
        onClose={onClose}
        dateMode={dateMode}
        onPickToday={() => {
          onDateChange({ dateMode: 'today', date: new Date() });
          onClose();
        }}
        onPickYesterday={() => {
          onDateChange({ dateMode: 'yesterday', date: yesterday() });
          onClose();
        }}
        onPickCustom={() => {
          onClose();
          pickDateTime(buildEntryDate(date, new Date()), (picked) => {
            onDateChange({ date: picked, dateMode: 'custom' });
          });
        }}
      />

      <PickerSheet
        visible={sheet === 'currency'}
        onClose={onClose}
        title={tr('fields.currency')}
        options={pickableCurrencies(currencies, effectiveCurrencyCode).map((c) => ({
          key: c.code,
          label: c.code,
        }))}
        selected={effectiveCurrencyCode}
        onSelect={(code) => code && onSelectCurrency(code)}
      />

      <PickerSheet
        visible={sheet === 'category'}
        onClose={onClose}
        title={tr('fields.category')}
        options={categories.map((c) => ({ key: c.name, label: c.name }))}
        selected={categoryName}
        onSelect={onSelectCategory}
        noneLabel={tr('common.none')}
      />

      <PickerSheet
        visible={sheet === 'budget'}
        onClose={onClose}
        title={tr('fields.budget')}
        options={budgets.map((b) => {
          const rem = envelopesOn ? allEnvelopes.get(b.id) : undefined;
          const trailing =
            rem !== undefined
              ? `${formatMoney(rem.replace(/^[-−]/, ''), currency)} ${isNegative(rem) ? tr('capture.overShort') : tr('capture.leftShort')}`
              : undefined;
          return { key: b.id, label: b.name, trailing };
        })}
        selected={budgetId}
        onSelect={onSelectBudget}
        noneLabel={tr('common.none')}
      />

      <PayeeSheet
        visible={sheet === 'payee'}
        onClose={onClose}
        histories={histories}
        payeeLabel={payeeType === 'deposit' ? 'payer' : 'payee'}
        onSelect={onSelectPayeeHistory}
        onCreateNew={onCreateNewPayee}
      />

      <AccountPickerSheet
        visible={!!accountSheetTarget}
        onClose={onClose}
        title={accountSheetTarget === 'source' ? tr('fields.from') : tr('fields.to')}
        accounts={assetAccounts}
        currencies={currencies}
        excludeId={accountSheetTarget === 'destination' && isTransfer ? effectiveSourceId : null}
        onSelect={(a) => {
          if (accountSheetTarget) {
            onSelectAccount(accountSheetTarget, a);
          }
        }}
      />

      <CaptureDetailsSheet
        visible={sheet === 'more'}
        onClose={onClose}
        notes={notes}
        tags={tags}
        sharedWith={sharedWith}
        date={date}
        dateMode={dateMode}
        photoUri={photoUri}
        recentTags={recentTags}
        sharedPeople={sharedPeople}
        onCommit={onCommitDetails}
        onAttachPhoto={onAttachPhoto}
        onRemovePhoto={onRemovePhoto}
      />
    </>
  );
}
