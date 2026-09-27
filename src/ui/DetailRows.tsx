// The DETAILS card (design §6.3, §6.5): one picker implementation shared by the draft screen and
// the transaction detail screen. Every row opens a sheet; nothing is an inline chip wall.
import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Card, Row, Chip, Button, Sheet } from './components';
import { useTheme } from './theme';
import { categoryColor } from './categoryColor';

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
  accounts: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  budgets: { id: string; name: string }[];
}

export function DetailRows({ value, onChange, onDatePress, readOnly, accounts, categories, budgets }: DetailRowsProps) {
  const t = useTheme();
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
  const [budgetSheetOpen, setBudgetSheetOpen] = useState(false);
  const [accountSheetTarget, setAccountSheetTarget] = useState<'source' | 'destination' | null>(null);
  const [textSheetOpen, setTextSheetOpen] = useState(false);

  const sourceAccount = accounts.find((a) => a.id === value.sourceAccountId);
  const destinationAccount = accounts.find((a) => a.id === value.destinationAccountId);
  const budget = budgets.find((b) => b.id === value.budgetId);

  return (
    <>
      <Card style={{ marginHorizontal: t.space.lg }}>
        {value.type !== 'transfer' && (
          <Row
            first
            label="Category"
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
            label="From"
            value={sourceAccount?.name ?? '—'}
            chevron={!readOnly}
            onPress={readOnly ? undefined : () => setAccountSheetTarget('source')}
          />
        )}
        {(value.type === 'deposit' || value.type === 'transfer') && (
          <Row
            label="To"
            value={destinationAccount?.name ?? '—'}
            chevron={!readOnly}
            onPress={readOnly ? undefined : () => setAccountSheetTarget('destination')}
          />
        )}
        {value.type !== 'transfer' && (
          <Row
            label="Budget"
            value={budget?.name ?? '—'}
            chevron={!readOnly}
            onPress={readOnly ? undefined : () => setBudgetSheetOpen(true)}
          />
        )}
        <Row label="Date" value={value.dateLabel} chevron={!readOnly} onPress={readOnly ? undefined : onDatePress} />
        <Row label="Note" value={value.notes || '—'} chevron={!readOnly} onPress={readOnly ? undefined : () => setTextSheetOpen(true)} />
        <Row label="Shared with" value={value.sharedWith || '—'} chevron={!readOnly} onPress={readOnly ? undefined : () => setTextSheetOpen(true)} />
      </Card>

      <Sheet visible={categorySheetOpen} onClose={() => setCategorySheetOpen(false)} title="Category">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
          <Chip label="None" selected={!value.categoryName} onPress={() => { onChange({ categoryName: null }); setCategorySheetOpen(false); }} />
          {categories.map((c) => (
            <Chip key={c.id} label={c.name} selected={c.name === value.categoryName} onPress={() => { onChange({ categoryName: c.name }); setCategorySheetOpen(false); }} />
          ))}
        </View>
      </Sheet>

      <Sheet visible={budgetSheetOpen} onClose={() => setBudgetSheetOpen(false)} title="Budget">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
          <Chip label="None" selected={!value.budgetId} onPress={() => { onChange({ budgetId: null }); setBudgetSheetOpen(false); }} />
          {budgets.map((b) => (
            <Chip key={b.id} label={b.name} selected={b.id === value.budgetId} onPress={() => { onChange({ budgetId: b.id }); setBudgetSheetOpen(false); }} />
          ))}
        </View>
      </Sheet>

      <Sheet visible={!!accountSheetTarget} onClose={() => setAccountSheetTarget(null)} title={accountSheetTarget === 'source' ? 'From' : 'To'}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
          {accounts.map((a) => (
            <Chip
              key={a.id}
              label={a.name}
              selected={(accountSheetTarget === 'source' ? value.sourceAccountId : value.destinationAccountId) === a.id}
              onPress={() => {
                onChange(accountSheetTarget === 'source' ? { sourceAccountId: a.id } : { destinationAccountId: a.id });
                setAccountSheetTarget(null);
              }}
            />
          ))}
        </View>
      </Sheet>

      <Sheet
        visible={textSheetOpen}
        onClose={() => setTextSheetOpen(false)}
        title="Note & shared with"
        footer={<Button title="Done" onPress={() => setTextSheetOpen(false)} />}
      >
        <Text style={[t.type.label, { color: t.color.textMuted }]}>Note</Text>
        <TextInput
          value={value.notes ?? ''}
          onChangeText={(v) => onChange({ notes: v })}
          multiline
          placeholderTextColor={t.color.textFaint}
          style={{ borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.sm, padding: t.space.md, color: t.color.text, minHeight: 60 }}
        />
        <Text style={[t.type.label, { color: t.color.textMuted, marginTop: t.space.sm }]}>Shared with</Text>
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
