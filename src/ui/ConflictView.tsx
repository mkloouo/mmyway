// What a transaction's page shows instead of the editor when a queued change conflicts with FF3:
// the server's values beside the ones this phone wants to send, and the two ways out.
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { AppBar, Button, Card, CloseButton, Screen } from './components';
import { useTheme } from './theme';
import { relativeTime } from './relativeTime';
import { formatMoney, type DisplayCurrency } from './money';
import { conflictFields } from '../transactions/conflictDiff';
import { readPayload } from '../sync/payloadJson';
import {
  dropQueuedChange,
  keepMineOverServer,
  type UpdateTransactionPayload,
} from '../sync/outbox';
import type { cachedTransactions, outboxOperations } from '../db/schema';
import { useAction } from './useAction';
import { useDb } from '../providers/DbProvider';

export function ConflictView({
  row,
  operation,
  accounts,
  budgets,
  currency,
}: {
  row: typeof cachedTransactions.$inferSelect;
  operation: typeof outboxOperations.$inferSelect;
  accounts: { id: string; name: string }[];
  budgets: { id: string; name: string }[];
  currency: DisplayCurrency;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const db = useDb();
  const act = useAction();

  const keepMine = act(tr('conflict.keepMine'), () =>
    keepMineOverServer(db, operation.id, row.updatedAt),
  );
  const discardMine = act(tr('conflict.useServer'), () => dropQueuedChange(db, operation.id));

  const pending = readPayload<UpdateTransactionPayload>(operation.kind, operation.payloadJson);
  const isDelete = operation.kind === 'delete_transaction';
  const fields = isDelete
    ? []
    : conflictFields(pending.changes ?? {}, row, {
        accountName: (accountId) => accounts.find((a) => a.id === accountId)?.name,
        budgetName: (budgetId) => budgets.find((b) => b.id === budgetId)?.name,
        money: (amount) => formatMoney(amount, currency),
      });

  return (
    <Screen bottom>
      <AppBar title={tr('inbox.conflict')} left={<CloseButton onPress={() => router.back()} />} />
      <ScrollView contentContainerStyle={{ padding: t.space.lg, gap: t.space.md }}>
        <Text style={[t.type.body, { color: t.color.textMuted }]}>
          {tr('conflict.changedInFf3', {
            description: row.description,
            time: relativeTime(row.updatedAt),
          })}{' '}
          {isDelete ? tr('conflict.youAskedToDelete') : tr('conflict.compareFields')}
        </Text>
        {!isDelete && (
          <Card>
            <View style={{ flexDirection: 'row', paddingBottom: t.space.sm }}>
              <Text style={[t.type.caption, { color: t.color.textMuted, flex: 1 }]}>
                {tr('conflict.field')}
              </Text>
              <Text style={[t.type.caption, { color: t.color.textMuted, flex: 2 }]}>
                {tr('conflict.server')}
              </Text>
              <Text style={[t.type.caption, { color: t.color.textMuted, flex: 2 }]}>
                {tr('conflict.yours')}
              </Text>
            </View>
            {fields.map((f) => (
              <View
                key={f.label}
                style={{
                  flexDirection: 'row',
                  paddingVertical: t.space.sm,
                  borderTopWidth: 1,
                  borderTopColor: t.color.border,
                }}
              >
                <Text style={[t.type.label, { color: t.color.textMuted, flex: 1 }]}>{f.label}</Text>
                <Text style={[t.type.body, { color: t.color.text, flex: 2 }]}>{f.server}</Text>
                <Text
                  style={[
                    t.type.body,
                    {
                      color: f.differs ? t.color.accent : t.color.text,
                      flex: 2,
                      fontWeight: f.differs ? '600' : '400',
                    },
                  ]}
                >
                  {f.mine}
                </Text>
              </View>
            ))}
            {fields.every((f) => !f.differs) && (
              <Text style={[t.type.label, { color: t.color.textMuted, paddingTop: t.space.sm }]}>
                {tr('conflict.matchesServer')}
              </Text>
            )}
          </Card>
        )}
        <Button
          title={isDelete ? tr('conflict.deleteAnyway') : tr('conflict.keepMine')}
          onPress={keepMine}
        />
        <Button
          title={isDelete ? tr('conflict.keepTransaction') : tr('conflict.useServer')}
          variant="danger"
          onPress={discardMine}
        />
      </ScrollView>
    </Screen>
  );
}
