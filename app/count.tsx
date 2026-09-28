// The cash count — the envelope sweep (design §6.9, decision C of §11). Counts every marked
// cash envelope in one pass; one confirm creates one adjustment per envelope that differs.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { eq, inArray } from 'drizzle-orm';
import { useLiveQuery } from '../src/db/useLiveQuery';
import { useCategories, useCurrencies } from '../src/db/useReferenceData';
import { useDb } from '../src/providers/DbProvider';
import { useTheme } from '../src/ui/theme';
import {
  Screen,
  AppBar,
  BarIconButton,
  Card,
  Row,
  Chip,
  Button,
  Sheet,
  Money,
  EmptyState,
  useKeyboardHeight,
} from '../src/ui/components';
import { currencyOf, formatMoney } from '../src/ui/money';
import { parseDecimalInput } from '../src/api/ff3/decimal';
import { relativeTime } from '../src/ui/relativeTime';
import { haptics } from '../src/ui/haptics';
import { referenceAccounts, outboxOperations, appSettings } from '../src/db/schema';
import { hasEnvelopeMarker } from '../src/accounts/envelopeMarker';
import { useAssetAccounts } from '../src/accounts/useAssetAccounts';
import { computeSweep, driftByCurrency, type SweepRow } from '../src/reconcile/sweep';
import { denominationsFor, totalDenominations } from '../src/reconcile/denominations';
import {
  countBlocker,
  describeCountBlocker,
  readCountBlocker,
} from '../src/reconcile/countReadiness';
import {
  getReconcileShortfallAccountId,
  setReconcileShortfallAccountId,
  getReconcileSurplusAccountId,
  setReconcileSurplusAccountId,
  getReconcileCategoryName,
  setReconcileCategoryName,
  BALANCES_STALE_KEY,
} from '../src/settings/appSettings';
import { useSync } from '../src/sync/useSync';
import { LEDGER_KINDS } from '../src/sync/outbox';
import { TextField } from '../src/ui/TextField';
import { useAction } from '../src/ui/useAction';
import { createAndConfirmAdjustment } from '../src/reconcile/adjustment';
import { PendingDot } from '../src/ui/PendingDot';
import { usePendingAccountIds } from '../src/accounts/usePendingAccountIds';
import { isBalanceStale } from '../src/utils/day';

export default function CountScreen() {
  const db = useDb();
  const t = useTheme();
  const { t: tr } = useTranslation();
  const act = useAction();
  const pendingAccounts = usePendingAccountIds();
  // Edge to edge, the window isn't resized for the keyboard; the lower envelopes need the room.
  const keyboardHeight = useKeyboardHeight();

  const { data: accountRows } = useLiveQuery(db.select().from(referenceAccounts));
  const categories = useCategories();
  const currencies = useCurrencies();
  const allAccounts = accountRows ?? [];
  const envelopeAccounts = (useAssetAccounts() ?? []).filter((a) => hasEnvelopeMarker(a.notes));
  const expenseAccounts = allAccounts.filter((a) => a.type === 'expense');
  const revenueAccounts = allAccounts.filter((a) => a.type === 'revenue');

  // The expected balances are only right once every queued write has reached FF3 and the
  // balances were read after that (src/reconcile/countReadiness.ts). Unknown until both load.
  const { status: syncStatus, syncNow } = useSync();
  const { data: queuedLedgerOps } = useLiveQuery(
    db
      .select({ id: outboxOperations.id })
      .from(outboxOperations)
      .where(inArray(outboxOperations.kind, [...LEDGER_KINDS])),
  );
  const { data: staleRows } = useLiveQuery(
    db.select().from(appSettings).where(eq(appSettings.key, BALANCES_STALE_KEY)),
  );
  const readinessLoaded = queuedLedgerOps !== undefined && staleRows !== undefined;
  const blocker = readinessLoaded
    ? countBlocker(queuedLedgerOps.length, staleRows[0]?.value === '1')
    : null;
  const canCount = readinessLoaded && !blocker;

  const [counts, setCounts] = useState<Record<string, string>>({});
  const [denomAccountId, setDenomAccountId] = useState<string | null>(null);
  const [denomCounts, setDenomCounts] = useState<Record<string, number>>({});
  const [reviewOpen, setReviewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [shortfallAccountId, setShortfallAccountIdState] = useState<string | null>(null);
  const [surplusAccountId, setSurplusAccountIdState] = useState<string | null>(null);
  const [reconcileCategory, setReconcileCategoryState] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getReconcileShortfallAccountId(db),
      getReconcileSurplusAccountId(db),
      getReconcileCategoryName(db),
    ]).then(([sf, sp, cat]) => {
      if (cancelled) return;
      setShortfallAccountIdState(sf);
      setSurplusAccountIdState(sp);
      setReconcileCategoryState(cat);
    });
    return () => {
      cancelled = true;
    };
  }, [db]);

  // A raw typed comma used to reach addDecimal (sweep.ts) unparsed and crash the screen —
  // parseDecimalInput here both normalizes it and catches what it rejects, before that.
  const invalidCounts = new Set(
    envelopeAccounts
      .filter((a) => {
        const raw = counts[a.id] ?? '';
        return (
          !!raw.trim() &&
          !parseDecimalInput(raw, currencyOf(currencies, a.currencyCode).decimalPlaces).ok
        );
      })
      .map((a) => a.id),
  );
  const sweepRows: SweepRow[] = envelopeAccounts.map((a) => {
    const raw = counts[a.id] ?? '';
    const result = raw.trim()
      ? parseDecimalInput(raw, currencyOf(currencies, a.currencyCode).decimalPlaces)
      : null;
    return {
      accountId: a.id,
      currencyCode: a.currencyCode,
      expected: a.currentBalance ?? '0',
      counted: result?.ok ? result.value : '',
    };
  });
  const adjustments = computeSweep(sweepRows);
  const drift = driftByCurrency(sweepRows);
  const countedRows = sweepRows.filter((r) => r.counted.trim());

  const oldestBalanceDate =
    envelopeAccounts
      .map((a) => a.currentBalanceDate)
      .filter((d): d is string => !!d)
      .sort()[0] ?? null;
  const stale = isBalanceStale(oldestBalanceDate);

  const confirmReview = act(tr('inbox.confirm'), async () => {
    // Re-read at the moment of booking: a write can be queued, or a sync land, while the
    // review sheet is open.
    const current = await readCountBlocker(db);
    if (current) {
      setReviewOpen(false);
      Alert.alert(tr('count.outOfDateTitle'), describeCountBlocker(current));
      return;
    }
    for (const adjustment of adjustments) {
      await createAndConfirmAdjustment(db, adjustment, {
        shortfallAccountId,
        surplusAccountId,
        categoryName: reconcileCategory,
      });
    }
    haptics.tick();
    setReviewOpen(false);
    router.back();
  });
  const confirming = act.pending(tr('inbox.confirm'));

  function openDenomPad(accountId: string) {
    setDenomAccountId(accountId);
    setDenomCounts({});
  }
  function applyDenomTotal() {
    if (!denomAccountId) return;
    const account = envelopeAccounts.find((a) => a.id === denomAccountId);
    const ladder = account ? denominationsFor(account.currencyCode) : null;
    if (ladder) {
      const total = totalDenominations(denomCounts, ladder);
      setCounts((c) => ({ ...c, [denomAccountId]: total }));
    }
    setDenomAccountId(null);
  }

  const missingSettings = adjustments.some((a) =>
    a.type === 'withdrawal' ? !shortfallAccountId : !surplusAccountId,
  );
  const denomAccount = envelopeAccounts.find((a) => a.id === denomAccountId) ?? null;
  const denomLadder = denomAccount ? denominationsFor(denomAccount.currencyCode) : null;

  return (
    <Screen bottom>
      <View style={{ flex: 1 }}>
        <AppBar
          title={tr('count.title')}
          subtitle={
            oldestBalanceDate
              ? tr('count.asOf', { time: relativeTime(oldestBalanceDate) })
              : undefined
          }
          left={
            <BarIconButton icon="close" label={tr('common.close')} onPress={() => router.back()} />
          }
          right={
            <BarIconButton
              icon="settings-outline"
              label={tr('count.settingsLabel')}
              onPress={() => setSettingsOpen(true)}
            />
          }
        />
        {stale && envelopeAccounts.length > 0 && (
          <View
            style={{
              backgroundColor: t.color.warnSoft,
              paddingHorizontal: t.space.lg,
              paddingVertical: t.space.sm,
            }}
          >
            <Text style={[t.type.label, { color: t.color.warn }]}>{tr('count.staleBanner')}</Text>
          </View>
        )}
        {!!blocker && envelopeAccounts.length > 0 && (
          <View
            style={{
              backgroundColor: t.color.warnSoft,
              paddingHorizontal: t.space.lg,
              paddingVertical: t.space.sm,
              gap: t.space.sm,
            }}
          >
            <Text style={[t.type.label, { color: t.color.warn }]}>
              {describeCountBlocker(blocker)}
            </Text>
            <Button
              title={syncStatus === 'syncing' ? tr('sync.syncing') : tr('sync.syncNow')}
              variant="secondary"
              onPress={() => syncNow()}
              disabled={syncStatus === 'syncing'}
            />
          </View>
        )}

        {envelopeAccounts.length === 0 ? (
          <EmptyState
            glyph="🧮"
            title={tr('count.emptyTitle')}
            hint={tr('count.emptyHint')}
            action={
              <Button
                title={tr('count.goToAccounts')}
                onPress={() => router.push('/settings/accounts')}
              />
            }
          />
        ) : (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{
              padding: t.space.lg,
              gap: t.space.sm,
              paddingBottom: t.space.lg + keyboardHeight,
            }}
            keyboardShouldPersistTaps="handled"
          >
            {envelopeAccounts.map((a) => {
              const currency = currencyOf(currencies, a.currencyCode);
              const counted = counts[a.id] ?? '';
              const invalid = invalidCounts.has(a.id);
              const adjustment = adjustments.find((adj) => adj.accountId === a.id);
              const matches = counted.trim() !== '' && !invalid && !adjustment;
              const ladder = denominationsFor(a.currencyCode);
              return (
                <Card key={a.id}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
                    <Text style={[t.type.heading, { color: t.color.text, flexShrink: 1 }]}>
                      {a.name}
                    </Text>
                    <PendingDot visible={pendingAccounts.has(a.id)} />
                  </View>
                  <Text style={[t.type.label, { color: t.color.textMuted, marginTop: t.space.xs }]}>
                    {tr('count.expected', {
                      amount: a.currentBalance ? formatMoney(a.currentBalance, currency) : '—',
                    })}
                  </Text>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: t.space.sm,
                      marginTop: t.space.sm,
                    }}
                  >
                    <TextField
                      value={counted}
                      onChangeText={(v) => setCounts((c) => ({ ...c, [a.id]: v }))}
                      keyboardType="decimal-pad"
                      placeholder="—"
                      style={{ flex: 1 }}
                    />
                    {!!ladder && (
                      <Pressable
                        onPress={() => openDenomPad(a.id)}
                        accessibilityRole="button"
                        accessibilityLabel={tr('count.byDenomination', { name: a.name })}
                      >
                        <Text style={{ fontSize: 20 }}>🧮</Text>
                      </Pressable>
                    )}
                    {invalid ? (
                      <Text style={[t.type.body, { color: t.color.danger }]}>
                        {tr('count.invalid')}
                      </Text>
                    ) : matches ? (
                      <Text style={[t.type.body, { color: t.color.income, fontWeight: '600' }]}>
                        ✓
                      </Text>
                    ) : adjustment ? (
                      <Money
                        amount={
                          adjustment.type === 'withdrawal'
                            ? `-${adjustment.amount}`
                            : adjustment.amount
                        }
                        currency={currency}
                      />
                    ) : (
                      <Text style={[t.type.body, { color: t.color.textFaint }]}>
                        {tr('count.skip')}
                      </Text>
                    )}
                  </View>
                  {invalid && (
                    <Text style={[t.type.label, { color: t.color.danger, marginTop: t.space.xs }]}>
                      {tr('common.invalidAmount')}
                    </Text>
                  )}
                </Card>
              );
            })}
          </ScrollView>
        )}

        {envelopeAccounts.length > 0 && (
          <View style={{ padding: t.space.lg, gap: t.space.sm }}>
            {drift.length > 0 && (
              <Text style={[t.type.label, { color: t.color.textMuted, textAlign: 'center' }]}>
                {tr('count.drift', {
                  amounts: drift
                    .map((d) => formatMoney(d.amount, currencyOf(currencies, d.currencyCode)))
                    .join(' · '),
                })}
              </Text>
            )}
            {invalidCounts.size > 0 ? (
              <Button title={tr('count.fixInvalid')} variant="secondary" disabled />
            ) : !canCount && countedRows.length > 0 ? (
              <Button title={tr('count.syncFirst')} variant="secondary" disabled />
            ) : countedRows.length > 0 && adjustments.length === 0 ? (
              <Button title={tr('count.allMatch')} variant="secondary" disabled />
            ) : (
              <Button
                title={tr('count.reviewCount', { count: adjustments.length })}
                onPress={() => setReviewOpen(true)}
                disabled={adjustments.length === 0}
                size="lg"
              />
            )}
          </View>
        )}
      </View>

      <Sheet
        visible={!!denomAccountId}
        onClose={() => setDenomAccountId(null)}
        title={tr('count.denominationsTitle')}
        footer={<Button title={tr('count.useTotal')} onPress={applyDenomTotal} />}
      >
        {!!denomLadder &&
          denomLadder.map((d) => (
            <View
              key={d.value}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: t.space.md,
                paddingVertical: t.space.xs,
              }}
            >
              <Text style={[t.type.body, { color: t.color.text, width: 60 }]}>{d.label}</Text>
              <Text style={[t.type.body, { color: t.color.textMuted }]}>×</Text>
              <TextField
                value={denomCounts[d.value] ? String(denomCounts[d.value]) : ''}
                onChangeText={(v) =>
                  setDenomCounts((c) => ({ ...c, [d.value]: Math.max(0, parseInt(v, 10) || 0) }))
                }
                keyboardType="number-pad"
                placeholder="0"
                style={{ flex: 1 }}
              />
            </View>
          ))}
      </Sheet>

      <Sheet
        visible={reviewOpen}
        onClose={() => setReviewOpen(false)}
        title={tr('count.reviewTitle')}
        footer={
          <Button
            title={
              confirming
                ? tr('draft.confirming')
                : missingSettings
                  ? tr('count.configureFirst')
                  : tr('count.confirmCount', { count: adjustments.length })
            }
            onPress={confirmReview}
            disabled={confirming || missingSettings || !canCount}
          />
        }
      >
        {adjustments.map((a) => {
          const account = envelopeAccounts.find((acc) => acc.id === a.accountId);
          return (
            <Row
              key={a.accountId}
              label={account?.name ?? a.accountId}
              value={`${a.type === 'withdrawal' ? '−' : '+'}${formatMoney(
                a.amount,
                currencyOf(currencies, a.currencyCode),
              )}`}
              tone={a.type === 'withdrawal' ? 'danger' : 'default'}
            />
          );
        })}
      </Sheet>

      <Sheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title={tr('count.settingsTitle')}
      >
        <Text style={[t.type.label, { color: t.color.textMuted }]}>
          {tr('count.shortfallPayee')}
        </Text>
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: t.space.sm,
            marginBottom: t.space.md,
          }}
        >
          {expenseAccounts.map((a) => (
            <Chip
              key={a.id}
              label={a.name}
              selected={a.id === shortfallAccountId}
              onPress={act(tr('count.shortfallPayee'), async () => {
                await setReconcileShortfallAccountId(db, a.id);
                setShortfallAccountIdState(a.id);
              })}
            />
          ))}
        </View>
        <Text style={[t.type.label, { color: t.color.textMuted }]}>{tr('count.surplusPayee')}</Text>
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: t.space.sm,
            marginBottom: t.space.md,
          }}
        >
          {revenueAccounts.map((a) => (
            <Chip
              key={a.id}
              label={a.name}
              selected={a.id === surplusAccountId}
              onPress={act(tr('count.surplusPayee'), async () => {
                await setReconcileSurplusAccountId(db, a.id);
                setSurplusAccountIdState(a.id);
              })}
            />
          ))}
        </View>
        <Text style={[t.type.label, { color: t.color.textMuted }]}>
          {tr('count.categoryOptional')}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
          <Chip
            label={tr('common.none')}
            selected={!reconcileCategory}
            onPress={act(tr('count.categoryOptional'), async () => {
              await setReconcileCategoryName(db, '');
              setReconcileCategoryState(null);
            })}
          />
          {categories.map((c) => (
            <Chip
              key={c.id}
              label={c.name}
              selected={c.name === reconcileCategory}
              onPress={act(tr('count.categoryOptional'), async () => {
                await setReconcileCategoryName(db, c.name);
                setReconcileCategoryState(c.name);
              })}
            />
          ))}
        </View>
      </Sheet>
    </Screen>
  );
}
