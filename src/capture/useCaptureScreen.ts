import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams } from 'expo-router';
import type { OutboxDb } from '../sync/outbox';
import { useBudgets, useCategories, useCurrencies } from '../db/useReferenceData';
import { useEnvelopeRemaining, useAllEnvelopesRemaining } from '../bucket/useEnvelopeRemaining';
import { useFlag } from '../flags/useFlag';
import { useAssetAccounts } from '../accounts/useAssetAccounts';
import { useCaptureDefaults } from './useCaptureDefaults';
import { startPositionRequest } from './position';
import {
  accountLastUsed,
  buildMerchantLookup,
  peekAccountLastUsed,
  peekMerchantLookup,
  type MerchantHistory,
} from '../lookup/merchantLookup';
import { useSharedPeople } from '../lookup/sharedPeople';
import { useRecentTags } from '../lookup/recentTags';
import { matchPayeeAlias } from '../lookup/aliases';
import { rankCandidates } from '../suggest/rank';
import { primaryCurrencyCode } from '../money/currencies';
import { TX_TYPES } from '../transactions/txTypes';
import { logLine } from '../utils/log';
import { errorMessage } from '../utils/errorMessage';
import type { CaptureForm } from './useCaptureForm';

export interface UseCaptureScreenParams {
  db: OutboxDb;
  type: 'withdrawal' | 'deposit' | 'transfer';
  amount: string;
  currencyCode: string | null;
  sourceId: string | null;
  destinationId: string | null;
  merchantRawInput: string;
  forceNewPayee: boolean;
  budgetId: string | null;
  isDirty: boolean;
  set: (patch: Partial<CaptureForm>) => void;
}

export function useCaptureScreen({
  db,
  type,
  currencyCode,
  sourceId,
  destinationId,
  merchantRawInput,
  forceNewPayee,
  budgetId,
  isDirty,
  set,
}: UseCaptureScreenParams) {
  const { t: tr } = useTranslation();
  const { defaultAccountId, defaultCurrencyCode } = useCaptureDefaults();

  const assetAccountRows = useAssetAccounts({ includeLiabilities: true });
  const assetAccounts = useMemo(() => assetAccountRows ?? [], [assetAccountRows]);
  const categories = useCategories();
  const sharedPeople = useSharedPeople();
  const recentTags = useRecentTags();
  const budgets = useBudgets();
  const currencies = useCurrencies();

  // A route can preset the entry: a reminder's "Move money" opens a transfer into one account
  // (?type=transfer&to=<accountId>).
  const params = useLocalSearchParams<{ type?: string; to?: string }>();
  useEffect(() => {
    const patch: Partial<CaptureForm> = {};
    const preset = TX_TYPES.find((x) => x.type === params.type);
    if (preset) patch.type = preset.type;
    if (params.to) patch.destinationId = params.to;
    if (Object.keys(patch).length > 0) set(patch);
  }, [params.type, params.to, set]);

  // Seeded from the lookup warmed at startup so the first frame already has suggestions.
  const lookupType = type === 'transfer' ? undefined : type;
  const [loaded, setLoaded] = useState<{
    type: string | undefined;
    list: MerchantHistory[];
  } | null>(null);
  const histories = useMemo(
    () =>
      loaded && loaded.type === lookupType ? loaded.list : (peekMerchantLookup(lookupType) ?? []),
    [loaded, lookupType],
  );
  const [accountRecency, setAccountRecency] = useState<Map<string, string>>(
    () => peekAccountLastUsed() ?? new Map(),
  );

  useEffect(() => {
    startPositionRequest(db);
  }, [db]);

  useEffect(() => {
    let cancelled = false;
    buildMerchantLookup(db, { type: lookupType })
      .then((map) => {
        if (!cancelled) setLoaded({ type: lookupType, list: [...map.values()] });
      })
      .catch((err) => logLine('warn', `merchant lookup failed: ${errorMessage(err)}`));
    accountLastUsed(db)
      .then((m) => {
        if (!cancelled) setAccountRecency(m);
      })
      .catch((err) => logLine('warn', `account recency failed: ${errorMessage(err)}`));
    return () => {
      cancelled = true;
    };
  }, [db, lookupType]);

  const recentAccounts = useMemo(
    () =>
      [...assetAccounts].sort((a, b) =>
        (accountRecency.get(b.name) ?? '').localeCompare(accountRecency.get(a.name) ?? ''),
      ),
    [assetAccounts, accountRecency],
  );

  const isPayeeType = type === 'withdrawal' || type === 'deposit';
  const effectiveCurrencyCode =
    currencyCode ?? defaultCurrencyCode ?? primaryCurrencyCode(currencies);
  const effectiveSourceId =
    sourceId ?? (type === 'withdrawal' || type === 'transfer' ? defaultAccountId : null);

  const [matchedFor, setMatchedFor] = useState<{ text: string; caption: string | null } | null>(
    null,
  );
  useEffect(() => {
    if (!isPayeeType || !merchantRawInput.trim()) return;
    let cancelled = false;
    matchPayeeAlias(db, merchantRawInput)
      .then((match) => {
        if (cancelled) return;
        const caption =
          match.matched && match.payeeName !== merchantRawInput
            ? tr('capture.booksViaAlias', { name: match.payeeName })
            : null;
        setMatchedFor({ text: merchantRawInput, caption });
      })
      .catch((err) => logLine('warn', `alias match failed: ${errorMessage(err)}`));
    return () => {
      cancelled = true;
    };
  }, [db, isPayeeType, merchantRawInput, tr]);

  const aliasCaption =
    isPayeeType && !forceNewPayee && matchedFor?.text === merchantRawInput
      ? matchedFor.caption
      : null;

  const rankedPayees = useMemo(() => {
    const list = rankCandidates(histories, {})
      .slice(0, 6)
      .map((c) => histories.find((h) => h.merchantKey === c.merchantKey))
      .filter((h): h is MerchantHistory => !!h);
    if (merchantRawInput) {
      const idx = list.findIndex((h) => h.displayName === merchantRawInput);
      if (idx > 0) {
        const [selected] = list.splice(idx, 1);
        if (selected) list.unshift(selected);
      }
    }
    return list;
  }, [histories, merchantRawInput]);

  const sourceAccount = assetAccounts.find((a) => a.id === effectiveSourceId);
  const destinationAccount = assetAccounts.find((a) => a.id === destinationId);
  const budget = budgets.find((b) => b.id === budgetId);
  const envelopeLeft = useEnvelopeRemaining(budgetId);
  const allEnvelopes = useAllEnvelopesRemaining();
  const envelopesOn = useFlag('budget');

  function applyPayeeHistory(h: MerchantHistory) {
    set({ merchantRawInput: h.displayName, forceNewPayee: false });
    if (h.topCategory) set({ categoryName: h.topCategory });
    if (h.topAccountName) {
      const acc = assetAccounts.find((a) => a.name === h.topAccountName);
      if (acc) {
        const patch: Partial<CaptureForm> =
          type === 'withdrawal' ? { sourceId: acc.id } : { destinationId: acc.id };
        if (!isDirty && acc.currencyCode) {
          patch.currencyCode = acc.currencyCode;
        }
        set(patch);
      }
    }
    if (h.topBudgetName) {
      const b = budgets.find((x) => x.name === h.topBudgetName);
      if (b) set({ budgetId: b.id });
    }
  }

  return {
    assetAccounts,
    categories,
    sharedPeople,
    recentTags,
    budgets,
    currencies,
    histories,
    recentAccounts,
    effectiveCurrencyCode,
    effectiveSourceId,
    aliasCaption,
    rankedPayees,
    sourceAccount,
    destinationAccount,
    budget,
    envelopeLeft,
    allEnvelopes,
    envelopesOn,
    applyPayeeHistory,
  };
}
