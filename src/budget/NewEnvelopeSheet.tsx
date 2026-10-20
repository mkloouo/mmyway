// New envelope, as a sheet opened from the Budget tab's + (design board 03):
// Name input, optional "Assign now" amount, Ready to Assign summary, and categories
// without an envelope as one-tap suggestions with a circular + action.
// Create runs validation, confirm, and outbox enqueue for create and optional initial assignment.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';
import {
  Button,
  Card,
  FieldRow,
  GroupFooter,
  IconButton,
  ListRow,
  SectionHeader,
  Sheet,
} from '../ui/kit';
import { useTheme } from '../ui/theme';
import { useAction } from '../ui/useAction';
import { confirmAction } from '../ui/confirm';
import { useDb } from '../providers/DbProvider';
import { useBudgets, useCategories } from '../db/useReferenceData';
import { enqueueBudgetCreate } from '../bucket/budgetActions';
import { assignToEnvelope } from '../bucket/actions';
import { useBucket } from '../bucket/useBucket';
import { compareDecimal, parseDecimalInput } from '../api/ff3/decimal';
import { formatMoney, type DisplayCurrency } from '../money/format';
import type { Period } from '../bucket/period';

const SUGGESTION_LIMIT = 6;

/** Category names without an active envelope of the same name (case-insensitive), A–Z, no repeats. */
function suggestedNames(categoryNames: string[], envelopeNames: string[]): string[] {
  const taken = new Set(envelopeNames.map((name) => name.toLowerCase()));
  const out: string[] = [];
  for (const name of [...categoryNames].sort((a, b) => a.localeCompare(b))) {
    const key = name.trim().toLowerCase();
    if (!key || taken.has(key)) continue;
    taken.add(key);
    out.push(name.trim());
    if (out.length === SUGGESTION_LIMIT) break;
  }
  return out;
}

export interface NewEnvelopeSheetProps {
  visible: boolean;
  onClose: () => void;
  currency?: DisplayCurrency;
  currencyCode?: string;
  readyToAssign?: string;
  period?: Period;
}

export function NewEnvelopeSheet({
  visible,
  onClose,
  currency: propCurrency,
  currencyCode: propCurrencyCode,
  readyToAssign: propRta,
  period: propPeriod,
}: NewEnvelopeSheetProps) {
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState('');
  const [assignNow, setAssignNow] = useState('');

  const t = useTheme();
  const { t: tr } = useTranslation();
  const db = useDb();
  const act = useAction();
  const budgets = useBudgets();
  const categories = useCategories();
  const bucket = useBucket();

  const currency = propCurrency ?? bucket.currency;
  const currencyCode = propCurrencyCode ?? bucket.currencyCode;
  const period = propPeriod ?? bucket.period;
  const readyToAssign = propRta ?? bucket.rta.readyToAssign;

  const close = () => {
    setName('');
    setNameError('');
    setAssignNow('');
    onClose();
  };

  const validateName = (text: string) => {
    setName(text);
    if (!text.trim()) {
      setNameError(tr('budget.emptyNameError'));
    } else if (
      budgets.some((b) => b.active && b.name.toLowerCase() === text.trim().toLowerCase())
    ) {
      setNameError(tr('budget.duplicateNameError', { name: text.trim() }));
    } else {
      setNameError('');
    }
  };

  const parsedAssign = assignNow.trim()
    ? parseDecimalInput(assignNow.trim(), currency.decimalPlaces)
    : null;
  const assignValid =
    !assignNow.trim() || (parsedAssign?.ok && !parsedAssign.value.startsWith('-'));

  const suggestions = suggestedNames(
    categories.map((c) => c.name),
    budgets.filter((b) => b.active).map((b) => b.name),
  );

  const create = act(tr('budget.createAction'), async () => {
    if (!name.trim() || nameError || !assignValid) {
      return;
    }
    const ok = await confirmAction(tr('budget.createTitle'), tr('budget.createAction'));
    if (!ok) return;

    const budgetId = await enqueueBudgetCreate(db, name.trim());
    if (parsedAssign?.ok && compareDecimal(parsedAssign.value, '0') > 0) {
      await assignToEnvelope(
        db,
        period,
        currencyCode,
        { budgetId, limitId: null },
        parsedAssign.value,
      );
    }
    close();
  });

  const zeroFormatted = formatMoney('0', currency);
  const assignPlaceholder = tr('budget.assignNowPlaceholder', { zero: zeroFormatted });

  return (
    <Sheet
      visible={visible}
      title={tr('budget.createTitle')}
      onClose={close}
      footer={
        <Button
          title={tr('budget.createEnvelope')}
          onPress={() => void create()}
          disabled={
            !name.trim() || !!nameError || !assignValid || act.pending(tr('budget.createAction'))
          }
        />
      }
    >
      <Card flush>
        <FieldRow
          first
          label={tr('budget.nameInline')}
          value={name}
          onChangeText={validateName}
          placeholder={tr('budget.namePlaceholder')}
          labelWidth={92}
        />
        <FieldRow
          label={tr('budget.assignNow')}
          value={assignNow}
          onChangeText={setAssignNow}
          placeholder={assignPlaceholder}
          keyboardType="decimal-pad"
          labelWidth={92}
        />
      </Card>
      <GroupFooter>
        {tr('budget.readyToAssignSubtitle', { amount: formatMoney(readyToAssign, currency) })}
      </GroupFooter>
      {nameError ? (
        <Text
          style={[
            t.type.label,
            { color: t.color.warn, marginHorizontal: t.space.lg, marginTop: t.space.xs },
          ]}
        >
          {nameError}
        </Text>
      ) : null}

      {suggestions.length > 0 && (
        <>
          <SectionHeader title={tr('budget.suggestedHeader')} />
          <Card flush>
            {suggestions.map((suggestion, index) => (
              <ListRow
                key={suggestion}
                first={index === 0}
                label={suggestion}
                onPress={() => validateName(suggestion)}
                trailing={
                  <IconButton
                    icon="add"
                    variant="tinted"
                    accessibilityLabel={tr('budget.useCategory', { name: suggestion })}
                    onPress={() => validateName(suggestion)}
                  />
                }
              />
            ))}
          </Card>
        </>
      )}
    </Sheet>
  );
}
