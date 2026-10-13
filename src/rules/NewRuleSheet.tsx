// New rule (Settings → Rules → +, or a transaction's ⋯ → Create a rule): a rule that matches the
// description and sets a category and/or a budget. Nothing is queued until the user confirms.
// An Edit sheet: the fields in a Card, one Save in the footer. Category and budget are picked
// inside the same sheet (a sheet never opens a second sheet), with a back chevron to the fields.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useDb } from '../providers/DbProvider';
import { useBudgetRows, useCategories } from '../db/useReferenceData';
import { useTheme } from '../ui/theme';
import { Button, Card, GroupFooter, ListRow, Row, Sheet } from '../ui/kit';
import { TextField } from '../ui/TextField';
import { confirmAction } from '../ui/confirm';
import { useAction } from '../ui/useAction';
import { createRule } from './actions';
import type { RuleAction, RuleTrigger } from '../planned/objects';

interface NewRuleInitial {
  match?: string;
  category?: string;
  budget?: string;
}

export function NewRuleSheet({
  visible,
  onClose,
  initial,
}: {
  visible: boolean;
  onClose: () => void;
  /** Prefill from the transaction the rule came from; empty for a rule made from scratch. */
  initial?: NewRuleInitial;
}) {
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const categories = useCategories();
  const budgets = useBudgetRows();
  const act = useAction();

  const [title, setTitle] = useState('');
  const [match, setMatch] = useState('');
  // Category and budget are kept by name: that is what FF3's set_category / set_budget actions take.
  const [category, setCategory] = useState<string | null>(null);
  const [budget, setBudget] = useState<string | null>(null);
  // The choice open inside the sheet; null is the fields.
  const [pick, setPick] = useState<'category' | 'budget' | null>(null);

  // Each opening starts from its initial values. Adjusted during render, not in an effect, so the
  // sheet never paints the previous opening's fields.
  const [wasVisible, setWasVisible] = useState(false);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setTitle(initial?.match ?? '');
      setMatch(initial?.match ?? '');
      setCategory(initial?.category || null);
      setBudget(initial?.budget || null);
      setPick(null);
    }
  }

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
    onClose();
  });

  const checkmark = (on: boolean) =>
    on ? <Ionicons name="checkmark" size={18} color={t.color.accent} /> : undefined;

  const pickOptions =
    pick === 'category'
      ? categories.map((c) => ({ key: c.name, label: c.name }))
      : (budgets ?? []).filter((b) => b.active).map((b) => ({ key: b.name, label: b.name }));
  const pickedValue = pick === 'category' ? category : budget;
  const choose = (value: string | null) => {
    if (pick === 'category') setCategory(value);
    else setBudget(value);
    setPick(null);
  };

  return (
    <Sheet
      visible={visible}
      title={
        pick === 'category'
          ? tr('fields.category')
          : pick === 'budget'
            ? tr('fields.budget')
            : tr('rules.newTitle')
      }
      onClose={onClose}
      onBack={pick ? () => setPick(null) : undefined}
      footer={
        pick ? undefined : (
          <Button
            title={saving ? tr('common.saving') : tr('common.save')}
            onPress={save}
            disabled={!canSave}
            size="lg"
          />
        )
      }
    >
      {pick ? (
        <Card flush>
          <ListRow
            first
            label={tr('common.none')}
            trailing={checkmark(pickedValue === null)}
            onPress={() => choose(null)}
          />
          {pickOptions.map((o) => (
            <ListRow
              key={o.key}
              label={o.label}
              trailing={checkmark(pickedValue === o.key)}
              onPress={() => choose(o.key)}
            />
          ))}
        </Card>
      ) : (
        <>
          <Card style={{ gap: t.space.sm }}>
            <Text style={[t.type.label, { color: t.color.textMuted }]}>
              {tr('fields.description')}
            </Text>
            <TextField value={title} onChangeText={setTitle} />
            <Text style={[t.type.label, { color: t.color.textMuted }]}>
              {tr('rules.fieldMatch')}
            </Text>
            <TextField value={match} onChangeText={setMatch} />
          </Card>
          <Card>
            <Row
              first
              label={tr('fields.category')}
              value={category ?? tr('common.none')}
              chevron
              onPress={() => setPick('category')}
            />
            <Row
              label={tr('fields.budget')}
              value={budget ?? tr('common.none')}
              chevron
              onPress={() => setPick('budget')}
            />
          </Card>
          <GroupFooter>{tr('rules.pickOne')}</GroupFooter>
        </>
      )}
    </Sheet>
  );
}
