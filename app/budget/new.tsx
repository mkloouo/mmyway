import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { AppBar, Button, CloseButton, Screen } from '../../src/ui/components';
import { TextField } from '../../src/ui/TextField';
import { useTheme } from '../../src/ui/theme';
import { useAction } from '../../src/ui/useAction';
import { confirmAction } from '../../src/ui/confirm';
import { useDb } from '../../src/providers/DbProvider';
import { useBudgetRows } from '../../src/db/useReferenceData';
import { enqueueBudgetCreate } from '../../src/bucket/budgetActions';

export default function NewEnvelopeScreen() {
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState('');
  const t = useTheme();
  const { t: tr } = useTranslation();
  const db = useDb();
  const act = useAction();
  const budgets = useBudgetRows() ?? [];

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

  const create = act(tr('budget.createAction'), async () => {
    if (!name.trim() || nameError) {
      return;
    }
    const ok = await confirmAction(tr('budget.createTitle'), tr('budget.createAction'));
    if (!ok) return;
    await enqueueBudgetCreate(db, name.trim());
    router.back();
  });

  return (
    <Screen bottom>
      <AppBar
        title={tr('budget.createTitle')}
        left={<CloseButton onPress={() => router.back()} />}
      />
      <View style={{ paddingHorizontal: t.space.lg, paddingTop: t.space.lg, gap: t.space.md }}>
        <View>
          <Text style={[t.type.label, { color: t.color.text, marginBottom: t.space.xs }]}>
            {tr('budget.nameLabel')}
          </Text>
          <TextField
            value={name}
            onChangeText={validateName}
            placeholder={tr('budget.namePlaceholder')}
            invalid={!!nameError}
          />
          {nameError && (
            <Text style={[t.type.label, { color: t.color.warn, marginTop: t.space.xs }]}>
              {nameError}
            </Text>
          )}
        </View>
        <Button
          title={tr('budget.createAction')}
          onPress={create}
          disabled={!name.trim() || !!nameError || act.pending(tr('budget.createAction'))}
        />
      </View>
    </Screen>
  );
}
