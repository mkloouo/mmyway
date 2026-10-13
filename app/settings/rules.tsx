// Settings → Rules: FF3's rule groups and the rules in them, cached in planned_objects
// (src/rules/model.ts). Switches and Run now go through the outbox, so they work offline. A switch
// shows at once: a queued toggle wins over the cached `active` until FF3 has answered it.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { and, asc, inArray } from 'drizzle-orm';
import { outboxOperations, plannedObjects } from '../../src/db/schema';
import { useLiveQuery } from '../../src/db/useLiveQuery';
import { useDb } from '../../src/providers/DbProvider';
import { useTheme } from '../../src/ui/theme';
import {
  Screen,
  BarIconButton,
  Card,
  SectionHeader,
  SCREEN_TOP_PADDING,
} from '../../src/ui/components';
import { ListRow, PushHeader } from '../../src/ui/kit';
import { confirmAction } from '../../src/ui/confirm';
import { useAction } from '../../src/ui/useAction';
import { isUnsent } from '../../src/sync/outbox';
import { tryReadPayload } from '../../src/sync/payloadJson';
import { rulesByGroup, type RuleGroupSummary } from '../../src/rules/model';
import { runRule, toggleRule, toggleRuleGroup } from '../../src/rules/actions';
import { NewRuleSheet } from '../../src/rules/NewRuleSheet';
import type { ToggleRuleGroupPayload, ToggleRulePayload } from '../../src/rules/replay';
import { RequireFlag } from '../../src/flags/RequireFlag';

function RulesPage() {
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const act = useAction();
  // A transaction's ⋯ → Create a rule lands here with the rule's prefill, and the sheet already open.
  const params = useLocalSearchParams<{ match?: string; category?: string; budget?: string }>();
  const [newRuleOpen, setNewRuleOpen] = useState(!!params.match);
  const { data: planned } = useLiveQuery(
    db
      .select()
      .from(plannedObjects)
      .where(inArray(plannedObjects.kind, ['rule', 'rule_group'])),
  );
  const { data: ops } = useLiveQuery(
    db
      .select()
      .from(outboxOperations)
      .where(and(inArray(outboxOperations.kind, ['toggle_rule', 'toggle_rule_group']), isUnsent()))
      .orderBy(asc(outboxOperations.sequence)),
  );

  // The cache as FF3 last answered it, with the queued switches laid over it (the last one queued wins).
  const groups = useMemo(() => {
    const queuedRules = new Map<string, boolean>();
    const queuedGroups = new Map<string, boolean>();
    for (const op of ops ?? []) {
      if (op.kind === 'toggle_rule') {
        const p = tryReadPayload<ToggleRulePayload>(op.kind, op.payloadJson);
        if (p) queuedRules.set(p.ruleId, p.active);
      } else {
        const p = tryReadPayload<ToggleRuleGroupPayload>(op.kind, op.payloadJson);
        if (p) queuedGroups.set(p.ruleGroupId, p.active);
      }
    }
    return rulesByGroup(planned ?? []).map((group): RuleGroupSummary => {
      const active = queuedGroups.get(group.id) ?? group.active;
      return {
        ...group,
        active,
        rules: group.rules.map((rule) => {
          const own = queuedRules.get(rule.id) ?? rule.active;
          return { ...rule, active: own, effectiveActive: own && active };
        }),
      };
    });
  }, [planned, ops]);

  const setGroup = act(tr('rules.changeGroup'), (id: string, active: boolean) =>
    toggleRuleGroup(db, id, active),
  );
  const setRule = act(tr('rules.changeRule'), (id: string, active: boolean) =>
    toggleRule(db, id, active),
  );
  const run = act(tr('rules.runNow'), async (id: string, title: string) => {
    const ok = await confirmAction(
      tr('rules.runTitle', { title }),
      tr('rules.runNow'),
      tr('rules.runBody'),
    );
    if (ok) await runRule(db, id);
  });

  // A group with no rules has nothing to show under its header, so it is left out.
  const shown = groups.filter((g) => g.rules.length > 0);

  return (
    <Screen bottom>
      <PushHeader
        backLabel={tr('settings.title')}
        onBack={() => router.back()}
        title={tr('rules.title')}
        right={
          <BarIconButton
            icon="add"
            label={tr('rules.newRule')}
            onPress={() => setNewRuleOpen(true)}
          />
        }
      />
      <ScrollView
        contentContainerStyle={{ paddingBottom: t.space.xxl, paddingTop: SCREEN_TOP_PADDING }}
      >
        {planned !== undefined && shown.length === 0 && (
          <Text
            style={[
              t.type.body,
              { color: t.color.textFaint, textAlign: 'center', padding: t.space.lg },
            ]}
          >
            {tr('rules.empty')}
          </Text>
        )}
        {shown.map((group, index) => (
          <View key={group.id}>
            <SectionHeader
              first={index === 0}
              title={group.title}
              action={
                <Switch
                  value={group.active}
                  accessibilityLabel={group.title}
                  onValueChange={(v) => setGroup(group.id, v)}
                  trackColor={{ false: t.color.border, true: t.color.accent }}
                  thumbColor={t.color.surface}
                />
              }
            />
            <Card flush style={{ marginHorizontal: t.space.lg, opacity: group.active ? 1 : 0.5 }}>
              {group.rules.map((rule, i) => (
                <ListRow
                  key={rule.id}
                  first={i === 0}
                  label={rule.title}
                  sub={rule.triggers[0]?.value}
                  trailing={
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
                      <Pressable
                        onPress={() => run(rule.id, rule.title)}
                        accessibilityRole="button"
                        hitSlop={8}
                      >
                        <Text style={[t.type.label, { color: t.color.accent }]}>
                          {tr('rules.runNow')}
                        </Text>
                      </Pressable>
                      <Switch
                        value={rule.active}
                        accessibilityLabel={rule.title}
                        onValueChange={(v) => setRule(rule.id, v)}
                        trackColor={{ false: t.color.border, true: t.color.accent }}
                        thumbColor={t.color.surface}
                      />
                    </View>
                  }
                />
              ))}
            </Card>
          </View>
        ))}
      </ScrollView>
      <NewRuleSheet
        visible={newRuleOpen}
        onClose={() => setNewRuleOpen(false)}
        initial={{ match: params.match, category: params.category, budget: params.budget }}
      />
    </Screen>
  );
}

export default function RulesRoute() {
  return (
    <RequireFlag name="ff3_rules">
      <RulesPage />
    </RequireFlag>
  );
}
