// The DETAILS card (design §6.3, §6.5): one picker implementation shared by the draft screen and
// the transaction detail screen. Every row opens a sheet; nothing is an inline chip wall.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, TextInput, View } from 'react-native';
import { Card, Row, Chip, Button, Sheet } from './components';
import { useTheme } from './theme';
import { categoryColor } from './categoryColor';
import { AccountPickerSheet, type AccountPickerAccount } from './AccountPickerSheet';

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

export interface DetailRowsProps {
  value: DetailRowsValue;
  onChange: (patch: Partial<DetailRowsValue>) => void;
  onDatePress: () => void;
  readOnly?: boolean;
  /** For display — an old transaction can name an account since made inactive. */
  accounts: AccountPickerAccount[];
  /** Choices offered when picking a new account. Defaults to `accounts`. */
  pickableAccounts?: AccountPickerAccount[];
  currencies: { code: string; symbol: string; decimalPlaces: number }[];
  categories: { id: string; name: string }[];
  budgets: { id: string; name: string }[];
}

export function DetailRows({ value, onChange, onDatePress, readOnly, accounts, pickableAccounts, currencies, categories, budgets }: DetailRowsProps) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
  const [budgetSheetOpen, setBudgetSheetOpen] = useState(false);
  const [accountSheetTarget, setAccountSheetTarget] = useState<'source' | 'destination' | null>(null);
  const [textSheetOpen, setTextSheetOpen] = useState(false);

  const sourceAccount = accounts.find((a) => a.id === value.sourceAccountId);
  const destinationAccount = accounts.find((a) => a.id === value.destinationAccountId);
  const budget = budgets.find((b) => b.id === value.budgetId);
  const accountChoices = pickableAccounts ?? accounts;

  return (
    <>
      <Card style={{ marginHorizontal: t.space.lg }}>
        {value.type !== 'transfer' && (
          <Row
            first
            label={tr('fields.category')}
            value={value.categoryName ?? '—'}
            chevron={!readOnly}
            leading={value.categoryName ? (
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: categoryColor(value.categoryName, t.dark) }} />
            ) : undefined}
            onPress={readOnly ? undefined : () => setCategorySheetOpen(true)}
          />
        )}
        {(value.type === 'withdrawal' || value.type === 'transfer') && (
          <Row
            first={value.type === 'transfer'}
            label={tr('fields.from')}
            value={sourceAccount?.name ?? '—'}
            chevron={!readOnly}
            onPress={readOnly ? undefined : () => setAccountSheetTarget('source')}
          />
        )}
        {(value.type === 'deposit' || value.type === 'transfer') && (
          <Row
            label={tr('fields.to')}
            value={destinationAccount?.name ?? '—'}
            chevron={!readOnly}
            onPress={readOnly ? undefined : () => setAccountSheetTarget('destination')}
          />
        )}
        {value.type !== 'transfer' && (
          <Row
            label={tr('fields.budget')}
            value={budget?.name ?? '—'}
            chevron={!readOnly}
            onPress={readOnly ? undefined : () => setBudgetSheetOpen(true)}
          />
        )}
        <Row label={tr('fields.date')} value={value.dateLabel} chevron={!readOnly} onPress={readOnly ? undefined : onDatePress} />
        <Row label={tr('fields.note')} value={value.notes || '—'} chevron={!readOnly} onPress={readOnly ? undefined : () => setTextSheetOpen(true)} />
        <Row label={tr('fields.sharedWith')} value={value.sharedWith || '—'} chevron={!readOnly} onPress={readOnly ? undefined : () => setTextSheetOpen(true)} />
      </Card>

      <Sheet visible={categorySheetOpen} onClose={() => setCategorySheetOpen(false)} title={tr('fields.category')}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
          <Chip label={tr('common.none')} selected={!value.categoryName} onPress={() => { onChange({ categoryName: null }); setCategorySheetOpen(false); }} />
          {categories.map((c) => (
            <Chip key={c.id} label={c.name} selected={c.name === value.categoryName} onPress={() => { onChange({ categoryName: c.name }); setCategorySheetOpen(false); }} />
          ))}
        </View>
      </Sheet>

      <Sheet visible={budgetSheetOpen} onClose={() => setBudgetSheetOpen(false)} title={tr('fields.budget')}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
          <Chip label={tr('common.none')} selected={!value.budgetId} onPress={() => { onChange({ budgetId: null }); setBudgetSheetOpen(false); }} />
          {budgets.map((b) => (
            <Chip key={b.id} label={b.name} selected={b.id === value.budgetId} onPress={() => { onChange({ budgetId: b.id }); setBudgetSheetOpen(false); }} />
          ))}
        </View>
      </Sheet>

      <AccountPickerSheet
        visible={!!accountSheetTarget}
        onClose={() => setAccountSheetTarget(null)}
        title={accountSheetTarget === 'source' ? tr('fields.from') : tr('fields.to')}
        accounts={accountChoices}
        currencies={currencies}
        excludeId={accountSheetTarget === 'destination' && value.type === 'transfer' ? value.sourceAccountId : null}
        onSelect={(a) => onChange(accountSheetTarget === 'source' ? { sourceAccountId: a.id } : { destinationAccountId: a.id })}
      />

      <Sheet
        visible={textSheetOpen}
        onClose={() => setTextSheetOpen(false)}
        title={tr('details.noteAndSharedWith')}
        footer={<Button title={tr('common.done')} onPress={() => setTextSheetOpen(false)} />}
      >
        <Text style={[t.type.label, { color: t.color.textMuted }]}>{tr('fields.note')}</Text>
        <TextInput
          value={value.notes ?? ''}
          onChangeText={(v) => onChange({ notes: v })}
          multiline
          placeholderTextColor={t.color.textFaint}
          style={{ borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.sm, padding: t.space.md, color: t.color.text, minHeight: 60 }}
        />
        <Text style={[t.type.label, { color: t.color.textMuted, marginTop: t.space.sm }]}>{tr('fields.sharedWith')}</Text>
        <TextInput
          value={value.sharedWith ?? ''}
          onChangeText={(v) => onChange({ sharedWith: v })}
          placeholderTextColor={t.color.textFaint}
          style={{ borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.sm, padding: t.space.md, color: t.color.text }}
        />
      </Sheet>
    </>
  );
}
