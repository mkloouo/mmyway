// New envelope, as a sheet opened from the Budget tab's +: one name, and the categories that do not
// have an envelope yet as one-tap suggestions. Create runs the same validation, confirm and outbox
// path the old create route had (enqueueBudgetCreate: queued, shown at once, confirmed first).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Button, Card, ListRow, SectionHeader, Sheet } from '../ui/kit';
import { TextField } from '../ui/TextField';
import { useTheme } from '../ui/theme';
import { useAction } from '../ui/useAction';
import { confirmAction } from '../ui/confirm';
import { useDb } from '../providers/DbProvider';
import { useBudgets, useCategories } from '../db/useReferenceData';
import { enqueueBudgetCreate } from '../bucket/budgetActions';

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

export function NewEnvelopeSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState('');
  const t = useTheme();
  const { t: tr } = useTranslation();
  const db = useDb();
  const act = useAction();
  const budgets = useBudgets();
  const categories = useCategories();

  // Every close, Create's included, empties the field, so the next opening starts clean.
  const close = () => {
    setName('');
    setNameError('');
    onClose();
  };

  const validateName = (text: string) => {
    setName(text);
    if (!text.trim()) {
      setNameError(tr('budget.emptyNameError'));
    } else if (budgets.some((b) => b.active && b.name.toLowerCase() === text.toLowerCase())) {
      setNameError(tr('budget.duplicateNameError', { name: text }));
    } else {
      setNameError('');
    }
  };

  const suggestions = suggestedNames(
    categories.map((c) => c.name),
    budgets.filter((b) => b.active).map((b) => b.name),
  );

  const create = act(tr('budget.createAction'), async () => {
    if (!name.trim() || nameError) {
      return;
    }
    const ok = await confirmAction(tr('budget.createTitle'), tr('budget.createAction'));
    if (!ok) return;
    await enqueueBudgetCreate(db, name.trim());
    close();
  });

  return (
    <Sheet
      visible={visible}
      title={tr('budget.createTitle')}
      onClose={close}
      footer={
        <Button
          title={tr('budget.createEnvelope')}
          onPress={() => void create()}
          disabled={!name.trim() || !!nameError || act.pending(tr('budget.createAction'))}
        />
      }
    >
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
          <Text style={[t.type.body, { color: t.color.text, width: 92 }]}>
            {tr('budget.nameInline')}
          </Text>
          <View style={{ flex: 1 }}>
            <TextField
              value={name}
              onChangeText={validateName}
              placeholder={tr('budget.namePlaceholder')}
              invalid={!!nameError}
              testID="new-envelope-name"
            />
          </View>
        </View>
      </Card>
      {nameError && <Text style={[t.type.label, { color: t.color.warn }]}>{nameError}</Text>}

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
                trailing={<Ionicons name="add" size={18} color={t.color.accent} />}
              />
            ))}
          </Card>
        </>
      )}
    </Sheet>
  );
}
