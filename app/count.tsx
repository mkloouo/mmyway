// The cash count — the envelope sweep (design §6.9, decision C of §11). Counts every marked
// cash envelope in one pass; one confirm creates one adjustment per envelope that differs.
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { eq, inArray } from 'drizzle-orm';
import { useLiveQuery } from '../src/db/useLiveQuery';
import { useDb } from '../src/providers/DbProvider';
import { useTheme } from '../src/ui/theme';
import { Screen, AppBar, BarIconButton, Card, Row, Chip, Button, Sheet, Money, EmptyState, useKeyboardHeight } from '../src/ui/components';
import { currencyOf } from '../src/ui/money';
import { parseDecimalInput } from '../src/api/ff3/decimal';
import { relativeTime } from '../src/ui/relativeTime';
import { haptics } from '../src/ui/haptics';
import { referenceAccounts, referenceCategories, referenceCurrencies, inboxItems, outboxOperations, appSettings } from '../src/db/schema';
import { hasEnvelopeMarker } from '../src/accounts/envelopeMarker';
import { useAssetAccounts } from '../src/accounts/useAssetAccounts';
import { computeSweep, driftByCurrency, type SweepRow, type SweepAdjustment } from '../src/reconcile/sweep';
import { denominationsFor, totalDenominations } from '../src/reconcile/denominations';
import { countBlocker, describeCountBlocker, readCountBlocker } from '../src/reconcile/countReadiness';
import { confirmInboxItem } from '../src/inbox/createManualEntry';
import {
  getReconcileShortfallAccountId, setReconcileShortfallAccountId,
  getReconcileSurplusAccountId, setReconcileSurplusAccountId,
  getReconcileCategoryName, setReconcileCategoryName,
  BALANCES_STALE_KEY,
} from '../src/settings/appSettings';
import { useSync } from '../src/sync/useSync';
import { generateId } from '../src/utils/id';
import type { Draft } from '../src/inbox/draft';
import { LEDGER_KINDS, type OutboxDb } from '../src/sync/outbox';

const STALE_MS = 24 * 60 * 60 * 1000;

async function createAndConfirmAdjustment(
  db: OutboxDb,
  adjustment: SweepAdjustment,
  settings: { shortfallAccountId: string | null; surplusAccountId: string | null; categoryName: string | null },
): Promise<void> {
  const isWithdrawal = adjustment.type === 'withdrawal';
  const payeeAccountId = isWithdrawal ? settings.shortfallAccountId : settings.surplusAccountId;
  if (!payeeAccountId) throw new Error('reconcile payee account is not configured');

  const now = new Date().toISOString();
  const draft: Draft = {
    type: adjustment.type,
    amount: adjustment.amount,
    currencyCode: adjustment.currencyCode,
    date: now,
    description: 'Cash count',
    isNewPayee: false,
    sourceId: isWithdrawal ? adjustment.accountId : payeeAccountId,
    destinationId: isWithdrawal ? payeeAccountId : adjustment.accountId,
    categoryName: settings.categoryName || undefined,
    extraTags: ['mmyway-reconcile'],
  };
  const id = generateId();
  await db.insert(inboxItems).values({ id, kind: 'manual_entry', state: 'captured', draftJson: JSON.stringify(draft), createdAt: now, updatedAt: now });
  await confirmInboxItem(db, id);
}

export default function CountScreen() {
  const db = useDb();
  const t = useTheme();
  // Edge to edge, the window isn't resized for the keyboard; the lower envelopes need the room.
  const keyboardHeight = useKeyboardHeight();

  const { data: accountRows } = useLiveQuery(db.select().from(referenceAccounts));
  const { data: categories } = useLiveQuery(db.select().from(referenceCategories));
  const { data: currencies } = useLiveQuery(db.select().from(referenceCurrencies));
  const allAccounts = accountRows ?? [];
  const envelopeAccounts = (useAssetAccounts() ?? []).filter((a) => hasEnvelopeMarker(a.notes));
  const expenseAccounts = allAccounts.filter((a) => a.type === 'expense');
  const revenueAccounts = allAccounts.filter((a) => a.type === 'revenue');

  // The expected balances are only right once every queued write has reached FF3 and the
  // balances were read after that (src/reconcile/countReadiness.ts). Unknown until both load.
  const { status: syncStatus, syncNow } = useSync();
  const { data: queuedLedgerOps } = useLiveQuery(
    db.select({ id: outboxOperations.id }).from(outboxOperations).where(inArray(outboxOperations.kind, [...LEDGER_KINDS])),
  );
  const { data: staleRows } = useLiveQuery(db.select().from(appSettings).where(eq(appSettings.key, BALANCES_STALE_KEY)));
  const readinessLoaded = queuedLedgerOps !== undefined && staleRows !== undefined;
  const blocker = readinessLoaded ? countBlocker(queuedLedgerOps.length, staleRows[0]?.value === '1') : null;
  const canCount = readinessLoaded && !blocker;

  const [counts, setCounts] = useState<Record<string, string>>({});
  const [denomAccountId, setDenomAccountId] = useState<string | null>(null);
  const [denomCounts, setDenomCounts] = useState<Record<string, number>>({});
  const [reviewOpen, setReviewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const [shortfallAccountId, setShortfallAccountIdState] = useState<string | null>(null);
  const [surplusAccountId, setSurplusAccountIdState] = useState<string | null>(null);
  const [reconcileCategory, setReconcileCategoryState] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    Promise.all([getReconcileShortfallAccountId(db), getReconcileSurplusAccountId(db), getReconcileCategoryName(db)]).then(([sf, sp, cat]) => {
      if (cancelled) return;
      setShortfallAccountIdState(sf);
      setSurplusAccountIdState(sp);
      setReconcileCategoryState(cat);
    });
    return () => { cancelled = true; };
  }, [db]);

  // A raw typed comma used to reach addDecimal (sweep.ts) unparsed and crash the screen —
  // parseDecimalInput here both normalizes it and catches what it rejects, before that.
  const invalidCounts = new Set(
    envelopeAccounts
      .filter((a) => {
        const raw = counts[a.id] ?? '';
        return !!raw.trim() && !parseDecimalInput(raw, currencyOf(currencies ?? [], a.currencyCode).decimalPlaces).ok;
      })
      .map((a) => a.id),
  );
  const sweepRows: SweepRow[] = envelopeAccounts.map((a) => {
    const raw = counts[a.id] ?? '';
    const result = raw.trim() ? parseDecimalInput(raw, currencyOf(currencies ?? [], a.currencyCode).decimalPlaces) : null;
    return { accountId: a.id, currencyCode: a.currencyCode, expected: a.currentBalance ?? '0', counted: result?.ok ? result.value : '' };
  });
  const adjustments = computeSweep(sweepRows);
  const drift = driftByCurrency(sweepRows);
  const countedRows = sweepRows.filter((r) => r.counted.trim());

  const oldestBalanceDate = envelopeAccounts
    .map((a) => a.currentBalanceDate)
    .filter((d): d is string => !!d)
    .sort()[0] ?? null;
  const stale = oldestBalanceDate ? new Date().getTime() - new Date(oldestBalanceDate).getTime() > STALE_MS : true;

  async function confirmReview() {
    if (confirming) return;
    setConfirming(true);
    try {
      // Re-read at the moment of booking: a write can be queued, or a sync land, while the
      // review sheet is open.
      const current = await readCountBlocker(db);
      if (current) {
        setReviewOpen(false);
        Alert.alert('Balances are out of date', describeCountBlocker(current));
        return;
      }
      for (const adjustment of adjustments) {
        await createAndConfirmAdjustment(db, adjustment, {
          shortfallAccountId, surplusAccountId, categoryName: reconcileCategory,
        });
      }
      haptics.tick();
      setReviewOpen(false);
      router.back();
    } finally {
      setConfirming(false);
    }
  }

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

  const missingSettings = adjustments.some((a) => (a.type === 'withdrawal' ? !shortfallAccountId : !surplusAccountId));
  const denomAccount = envelopeAccounts.find((a) => a.id === denomAccountId) ?? null;
  const denomLadder = denomAccount ? denominationsFor(denomAccount.currencyCode) : null;

  return (
    <Screen bottom>
      <View style={{ flex: 1 }}>
        <AppBar
          title="Count cash"
          subtitle={oldestBalanceDate ? `as of ${relativeTime(oldestBalanceDate)}` : undefined}
          left={<BarIconButton icon="close" label="Close" onPress={() => router.back()} />}
          right={<BarIconButton icon="settings-outline" label="Reconcile settings" onPress={() => setSettingsOpen(true)} />}
        />
        {stale && envelopeAccounts.length > 0 && (
          <View style={{ backgroundColor: t.color.warnSoft, paddingHorizontal: t.space.lg, paddingVertical: t.space.sm }}>
            <Text style={[t.type.label, { color: t.color.warn }]}>Balances are more than a day old — counting against a stale expectation may be wrong.</Text>
          </View>
        )}
        {!!blocker && envelopeAccounts.length > 0 && (
          <View style={{ backgroundColor: t.color.warnSoft, paddingHorizontal: t.space.lg, paddingVertical: t.space.sm, gap: t.space.sm }}>
            <Text style={[t.type.label, { color: t.color.warn }]}>{describeCountBlocker(blocker)}</Text>
            <Button
              title={syncStatus === 'syncing' ? 'Syncing…' : 'Sync now'}
              variant="secondary"
              onPress={() => syncNow()}
              disabled={syncStatus === 'syncing'}
            />
          </View>
        )}

        {envelopeAccounts.length === 0 ? (
          <EmptyState
            glyph="🧮"
            title="No accounts are marked as cash envelopes"
            hint="Mark an asset account in its editor."
            action={<Button title="Go to accounts" onPress={() => router.push('/settings/accounts')} />}
          />
        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: t.space.lg, gap: t.space.sm, paddingBottom: t.space.lg + keyboardHeight }} keyboardShouldPersistTaps="handled">
            {envelopeAccounts.map((a) => {
              const currency = currencyOf(currencies ?? [], a.currencyCode);
              const counted = counts[a.id] ?? '';
              const invalid = invalidCounts.has(a.id);
              const adjustment = adjustments.find((adj) => adj.accountId === a.id);
              const matches = counted.trim() !== '' && !invalid && !adjustment;
              const ladder = denominationsFor(a.currencyCode);
              return (
                <Card key={a.id}>
                  <Text style={[t.type.heading, { color: t.color.text }]}>{a.name}</Text>
                  <Text style={[t.type.label, { color: t.color.textMuted, marginTop: t.space.xs }]}>
                    expected {a.currentBalance ? `${a.currentBalance} ${currency.symbol}` : '—'}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm, marginTop: t.space.sm }}>
                    <TextInput
                      value={counted}
                      onChangeText={(v) => setCounts((c) => ({ ...c, [a.id]: v }))}
                      keyboardType="decimal-pad"
                      placeholder="—"
                      placeholderTextColor={t.color.textFaint}
                      style={{
                        flex: 1, borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.sm,
                        paddingHorizontal: t.space.md, paddingVertical: t.space.sm, color: t.color.text,
                      }}
                    />
                    {!!ladder && (
                      <Pressable onPress={() => openDenomPad(a.id)} accessibilityRole="button" accessibilityLabel={`Count ${a.name} by denomination`}>
                        <Text style={{ fontSize: 20 }}>🧮</Text>
                      </Pressable>
                    )}
                    {invalid ? (
                      <Text style={[t.type.body, { color: t.color.danger }]}>Invalid</Text>
                    ) : matches ? (
                      <Text style={[t.type.body, { color: t.color.income, fontWeight: '600' }]}>✓</Text>
                    ) : adjustment ? (
                      <Money amount={adjustment.type === 'withdrawal' ? `-${adjustment.amount}` : adjustment.amount} currency={currency} />
                    ) : (
                      <Text style={[t.type.body, { color: t.color.textFaint }]}>skip</Text>
                    )}
                  </View>
                  {invalid && (
                    <Text style={[t.type.label, { color: t.color.danger, marginTop: t.space.xs }]}>Invalid amount</Text>
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
                Drift {drift.map((d) => `${d.amount} ${d.currencyCode}`).join(' · ')}
              </Text>
            )}
            {invalidCounts.size > 0 ? (
              <Button title="Fix the invalid amount above" variant="secondary" disabled />
            ) : !canCount && countedRows.length > 0 ? (
              <Button title="Sync before counting" variant="secondary" disabled />
            ) : countedRows.length > 0 && adjustments.length === 0 ? (
              <Button title="Everything matches ✓" variant="secondary" disabled />
            ) : (
              <Button
                title={`Review ${adjustments.length} adjustment${adjustments.length === 1 ? '' : 's'}`}
                onPress={() => setReviewOpen(true)}
                disabled={adjustments.length === 0}
                size="lg"
              />
            )}
          </View>
        )}
      </View>

      <Sheet visible={!!denomAccountId} onClose={() => setDenomAccountId(null)} title="Count denominations" footer={<Button title="Use this total" onPress={applyDenomTotal} />}>
        {!!denomLadder && denomLadder.map((d) => (
          <View key={d.value} style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md, paddingVertical: t.space.xs }}>
            <Text style={[t.type.body, { color: t.color.text, width: 60 }]}>{d.label}</Text>
            <Text style={[t.type.body, { color: t.color.textMuted }]}>×</Text>
            <TextInput
              value={denomCounts[d.value] ? String(denomCounts[d.value]) : ''}
              onChangeText={(v) => setDenomCounts((c) => ({ ...c, [d.value]: Math.max(0, parseInt(v, 10) || 0) }))}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={t.color.textFaint}
              style={{ flex: 1, borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.sm, paddingHorizontal: t.space.md, paddingVertical: t.space.sm, color: t.color.text }}
            />
          </View>
        ))}
      </Sheet>

      <Sheet
        visible={reviewOpen}
        onClose={() => setReviewOpen(false)}
        title="Review adjustments"
        footer={(
          <Button
            title={confirming ? 'Confirming…' : missingSettings ? 'Configure payees first (⚙)' : `Confirm ${adjustments.length}`}
            onPress={confirmReview}
            disabled={confirming || missingSettings || !canCount}
          />
        )}
      >
        {adjustments.map((a) => {
          const account = envelopeAccounts.find((acc) => acc.id === a.accountId);
          return (
            <Row
              key={a.accountId}
              label={account?.name ?? a.accountId}
              value={`${a.type === 'withdrawal' ? '−' : '+'}${a.amount} ${a.currencyCode}`}
              tone={a.type === 'withdrawal' ? 'danger' : 'default'}
            />
          );
        })}
      </Sheet>

      <Sheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} title="Cash count settings">
        <Text style={[t.type.label, { color: t.color.textMuted }]}>Shortfall payee (expense account)</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm, marginBottom: t.space.md }}>
          {expenseAccounts.map((a) => (
            <Chip key={a.id} label={a.name} selected={a.id === shortfallAccountId} onPress={async () => { await setReconcileShortfallAccountId(db, a.id); setShortfallAccountIdState(a.id); }} />
          ))}
        </View>
        <Text style={[t.type.label, { color: t.color.textMuted }]}>Surplus payee (revenue account)</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm, marginBottom: t.space.md }}>
          {revenueAccounts.map((a) => (
            <Chip key={a.id} label={a.name} selected={a.id === surplusAccountId} onPress={async () => { await setReconcileSurplusAccountId(db, a.id); setSurplusAccountIdState(a.id); }} />
          ))}
        </View>
        <Text style={[t.type.label, { color: t.color.textMuted }]}>Category (optional)</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
          <Chip label="None" selected={!reconcileCategory} onPress={async () => { await setReconcileCategoryName(db, ''); setReconcileCategoryState(null); }} />
          {(categories ?? []).map((c) => (
            <Chip key={c.id} label={c.name} selected={c.name === reconcileCategory} onPress={async () => { await setReconcileCategoryName(db, c.name); setReconcileCategoryState(c.name); }} />
          ))}
        </View>
      </Sheet>
    </Screen>
  );
}
