// New rule (Settings → Rules → +, or a transaction's ⋯ → Create a rule): a rule that matches the
// description and sets a category and/or a budget. Nothing is queued until the user confirms.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useDb } from '../../src/providers/DbProvider';
import { useBudgetRows, useCategories } from '../../src/db/useReferenceData';
import { useTheme } from '../../src/ui/theme';
import {
  Screen,
  AppBar,
  SectionHeader,
  Card,
  Row,
  Button,
  SCREEN_TOP_PADDING,
} from '../../src/ui/components';
import { TextField } from '../../src/ui/TextField';
import { PickerSheet } from '../../src/ui/PickerSheet';
import { confirmAction } from '../../src/ui/confirm';
import { useAction } from '../../src/ui/useAction';
import { createRule } from '../../src/rules/actions';
import type { RuleAction, RuleTrigger } from '../../src/planned/objects';

export default function NewRuleScreen() {
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const params = useLocalSearchParams<{ match?: string; category?: string; budget?: string }>();
  const categories = useCategories();
  const budgets = useBudgetRows();
  const act = useAction();

  const [title, setTitle] = useState(params.match ?? '');
  const [match, setMatch] = useState(params.match ?? '');
  // Category and budget are kept by name: that is what FF3's set_category / set_budget actions take.
  const [category, setCategory] = useState<string | null>(params.category || null);
  const [budget, setBudget] = useState<string | null>(params.budget || null);
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
  const [budgetSheetOpen, setBudgetSheetOpen] = useState(false);

  const saving = act.pending(tr('common.save'));
  const canSave =
    title.trim() !== '' && match.trim() !== '' && (category !== null || budget !== null) && !saving;

  const save = act(tr('common.save'), async () => {
    if (!canSave) return;
    const confirmed = await confirmAction(
      tr('rules.createTitle'),
      tr('common.save'),
      tr('rules.createBody'),
    );
    if (!confirmed) return;
    const triggers: RuleTrigger[] = [{ type: 'description_contains', value: match.trim() }];
    const actions: RuleAction[] = [];
    if (category) actions.push({ type: 'set_category', value: category });
    if (budget) actions.push({ type: 'set_budget', value: budget });
    await createRule(db, { title: title.trim(), triggers, actions });
    router.back();
  });

  return (
    <Screen bottom avoidKeyboard>
      <View style={{ flex: 1 }}>
        <AppBar title={tr('rules.newTitle')} />
        <ScrollView
          contentContainerStyle={{ paddingBottom: t.space.xl, paddingTop: SCREEN_TOP_PADDING }}
          keyboardShouldPersistTaps="handled"
        >
          <SectionHeader first title={tr('rules.sectionRule')} />
          <Card style={{ marginHorizontal: t.space.lg, gap: t.space.sm }}>
            <Text style={[t.type.label, { color: t.color.textMuted }]}>
              {tr('fields.description')}
            </Text>
            <TextField value={title} onChangeText={setTitle} />
            <Text style={[t.type.label, { color: t.color.textMuted }]}>
              {tr('rules.fieldMatch')}
            </Text>
            <TextField value={match} onChangeText={setMatch} />
          </Card>

          <SectionHeader title={tr('rules.sectionSets')} />
          <Card style={{ marginHorizontal: t.space.lg }}>
            <Row
              first
              label={tr('fields.category')}
              value={category ?? tr('common.none')}
              chevron
              onPress={() => setCategorySheetOpen(true)}
            />
            <Row
              label={tr('fields.budget')}
              value={budget ?? tr('common.none')}
              chevron
              onPress={() => setBudgetSheetOpen(true)}
            />
          </Card>
          <Text style={[t.type.label, { color: t.color.textFaint, padding: t.space.lg }]}>
            {tr('rules.pickOne')}
          </Text>
        </ScrollView>

        <View style={{ padding: t.space.lg, gap: t.space.sm }}>
          <Button
            title={saving ? tr('common.saving') : tr('common.save')}
            onPress={save}
            disabled={!canSave}
            size="lg"
          />
        </View>
      </View>

      <PickerSheet
        visible={categorySheetOpen}
        onClose={() => setCategorySheetOpen(false)}
        title={tr('fields.category')}
        options={categories.map((c) => ({ key: c.name, label: c.name }))}
        selected={category}
        noneLabel={tr('common.none')}
        onSelect={setCategory}
      />
      <PickerSheet
        visible={budgetSheetOpen}
        onClose={() => setBudgetSheetOpen(false)}
        title={tr('fields.budget')}
        options={(budgets ?? [])
          .filter((b) => b.active)
          .map((b) => ({ key: b.name, label: b.name }))}
        selected={budget}
        noneLabel={tr('common.none')}
        onSelect={setBudget}
      />
    </Screen>
  );
}
