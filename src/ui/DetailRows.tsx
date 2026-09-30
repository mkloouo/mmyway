// The DETAILS card (design §6.3, §6.5): one picker implementation shared by the draft screen and
// the transaction detail screen. Every row opens a sheet; nothing is an inline chip wall.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';
import { Card, Dot, Row, Button, Sheet } from './components';
import { useTheme } from './theme';
import { categoryColor } from './categoryColor';
import { AccountPickerSheet, type AccountPickerAccount } from './AccountPickerSheet';
import { TextField } from './TextField';
import { PickerSheet } from './PickerSheet';

export interface DetailRowsValue {
  type: 'withdrawal' | 'deposit' | 'transfer';
  categoryName: string | null;
  sourceAccountId: string | null;
  destinationAccountId: string | null;
  budgetId: string | null;
  dateLabel: string;
  notes: string | null;
  sharedWith: string | null;
}

/** Rows the receipt reader wasn't sure about (src/inbox/unsure.ts): drawn amber, to be checked. */
type UnsureRow = 'payee' | 'category' | 'date';

interface DetailRowsProps {
  value: DetailRowsValue;
  onChange: (patch: Partial<DetailRowsValue>) => void;
  onDatePress: () => void;
  /**
   * The payee (an expense) or payer (an income) as the first row, when the screen has one to edit.
   * Left out on a split page, which shows each split's payee itself; never shown on a transfer.
   */
  payee?: { name: string | null | undefined; onPress: () => void };
  unsure?: ReadonlySet<UnsureRow>;
  readOnly?: boolean;
  /** For display — an old transaction can name an account since made inactive. */
  accounts: AccountPickerAccount[];
  /** Choices offered when picking a new account. Defaults to `accounts`. */
  pickableAccounts?: AccountPickerAccount[];
  currencies: { code: string; symbol: string; decimalPlaces: number }[];
  categories: { id: string; name: string }[];
  budgets: { id: string; name: string }[];
  /** The accounts and budgets are still loading: their rows show a spinner, not "—". */
  loading?: boolean;
}

/**
 * True from the first time `open` is true on. A closed sheet builds nothing until it has been
 * opened once (a row's page holds four of them, and a receipt many pages); it stays mounted
 * after that so it can fade out instead of vanishing.
 */
function useOpened(open: boolean) {
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);
  return opened;
}

export function DetailRows({
  value,
  onChange,
  onDatePress,
  readOnly,
  accounts,
  pickableAccounts,
  currencies,
  categories,
  budgets,
  loading,
  payee,
  unsure,
}: DetailRowsProps) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
  const [budgetSheetOpen, setBudgetSheetOpen] = useState(false);
  const [accountSheetTarget, setAccountSheetTarget] = useState<'source' | 'destination' | null>(
    null,
  );
  const [textSheetOpen, setTextSheetOpen] = useState(false);
  const categoryOpened = useOpened(categorySheetOpen);
  const budgetOpened = useOpened(budgetSheetOpen);
  const accountOpened = useOpened(!!accountSheetTarget);
  const textOpened = useOpened(textSheetOpen);
  /** A row is tappable, with a chevron, unless the screen is read-only. */
  const edit = (onPress: () => void) => (readOnly ? {} : { chevron: true, onPress });

  const sourceAccount = accounts.find((a) => a.id === value.sourceAccountId);
  const destinationAccount = accounts.find((a) => a.id === value.destinationAccountId);
  const budget = budgets.find((b) => b.id === value.budgetId);
  const accountChoices = pickableAccounts ?? accounts;
  const showPayee = !!payee && value.type !== 'transfer';
  const check = (row: UnsureRow) => (unsure?.has(row) ? { tone: 'warn' as const } : {});

  return (
    <>
      <Card style={{ marginHorizontal: t.space.lg }}>
        {showPayee && payee && (
          <Row
            first
            label={value.type === 'deposit' ? tr('capture.payer') : tr('capture.payee')}
            value={payee.name || '—'}
            {...check('payee')}
            {...edit(payee.onPress)}
          />
        )}
        {value.type !== 'transfer' && (
          <Row
            first={!showPayee}
            label={tr('fields.category')}
            value={value.categoryName ?? '—'}
            leading={
              value.categoryName ? (
                <Dot color={categoryColor(value.categoryName, t.dark)} />
              ) : undefined
            }
            {...check('category')}
            {...edit(() => setCategorySheetOpen(true))}
          />
        )}
        {(value.type === 'withdrawal' || value.type === 'transfer') && (
          <Row
            first={value.type === 'transfer'}
            label={tr('fields.from')}
            value={sourceAccount?.name ?? '—'}
            loading={loading && !sourceAccount && !!value.sourceAccountId}
            {...edit(() => setAccountSheetTarget('source'))}
          />
        )}
        {(value.type === 'deposit' || value.type === 'transfer') && (
          <Row
            label={tr('fields.to')}
            value={destinationAccount?.name ?? '—'}
            loading={loading && !destinationAccount && !!value.destinationAccountId}
            {...edit(() => setAccountSheetTarget('destination'))}
          />
        )}
        {value.type !== 'transfer' && (
          <Row
            label={tr('fields.budget')}
            value={budget?.name ?? '—'}
            loading={loading && !budget && !!value.budgetId}
            {...edit(() => setBudgetSheetOpen(true))}
          />
        )}
        <Row
          label={tr('fields.date')}
          value={value.dateLabel}
          {...check('date')}
          {...edit(onDatePress)}
        />
        <Row
          label={tr('fields.note')}
          value={value.notes || '—'}
          {...edit(() => setTextSheetOpen(true))}
        />
        <Row
          label={tr('fields.sharedWith')}
          value={value.sharedWith || '—'}
          {...edit(() => setTextSheetOpen(true))}
        />
      </Card>

      {categoryOpened && (
        <PickerSheet
          visible={categorySheetOpen}
          onClose={() => setCategorySheetOpen(false)}
          title={tr('fields.category')}
          options={categories.map((c) => ({ key: c.name, label: c.name }))}
          selected={value.categoryName}
          onSelect={(categoryName) => onChange({ categoryName })}
          noneLabel={tr('common.none')}
        />
      )}

      {budgetOpened && (
        <PickerSheet
          visible={budgetSheetOpen}
          onClose={() => setBudgetSheetOpen(false)}
          title={tr('fields.budget')}
          options={budgets.map((b) => ({ key: b.id, label: b.name }))}
          selected={value.budgetId}
          onSelect={(budgetId) => onChange({ budgetId })}
          noneLabel={tr('common.none')}
        />
      )}

      {accountOpened && (
        <AccountPickerSheet
          visible={!!accountSheetTarget}
          onClose={() => setAccountSheetTarget(null)}
          title={accountSheetTarget === 'source' ? tr('fields.from') : tr('fields.to')}
          accounts={accountChoices}
          currencies={currencies}
          excludeId={
            accountSheetTarget === 'destination' && value.type === 'transfer'
              ? value.sourceAccountId
              : null
          }
          onSelect={(a) =>
            onChange(
              accountSheetTarget === 'source'
                ? { sourceAccountId: a.id }
                : { destinationAccountId: a.id },
            )
          }
        />
      )}

      {textOpened && (
        <Sheet
          visible={textSheetOpen}
          onClose={() => setTextSheetOpen(false)}
          title={tr('details.noteAndSharedWith')}
          footer={<Button title={tr('common.done')} onPress={() => setTextSheetOpen(false)} />}
        >
          <Text style={[t.type.label, { color: t.color.textMuted }]}>{tr('fields.note')}</Text>
          <TextField
            value={value.notes ?? ''}
            onCommit={(v) => onChange({ notes: v })}
            multiline
            style={{ minHeight: 60 }}
          />
          <Text style={[t.type.label, { color: t.color.textMuted, marginTop: t.space.sm }]}>
            {tr('fields.sharedWith')}
          </Text>
          <TextField
            value={value.sharedWith ?? ''}
            onCommit={(v) => onChange({ sharedWith: v })}
            placeholder={tr('details.sharedWithPlaceholder')}
          />
        </Sheet>
      )}
    </>
  );
}
