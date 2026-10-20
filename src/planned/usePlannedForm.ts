import { useEffect, useState } from 'react';
import { useDb } from '../providers/DbProvider';
import { useAssetAccounts } from '../accounts/useAssetAccounts';
import { useCategories, useCurrencyRows } from '../db/useReferenceData';
import { referenceCurrencies } from '../db/schema';
import { currencyOf } from '../ui/money';
import { getDefaultCurrencyCode, getDefaultSourceAccountId } from '../settings/appSettings';
import { primaryCurrencyCode } from '../ui/currencies';
import { useMerchantHistories } from '../lookup/useMerchantHistories';
import type { MerchantHistory } from '../lookup/merchantLookup';
import { blankPlanned, plannedProblems, samePlannedFields, type PlannedFields } from './model';
import type { PlannedItem } from './items';

export type OpenSheet =
  'amount' | 'currency' | 'own' | 'ownTo' | 'payee' | 'category' | 'remind' | null;

/**
 * Shared form state and derivations between New Planned Payment (`app/planned/new.tsx`)
 * and Planned Item editor (`app/planned/[key].tsx`).
 */
export function usePlannedForm(item: PlannedItem | null) {
  const isNew = !item;
  const db = useDb();
  const assetAccounts = useAssetAccounts({ includeLiabilities: true }) ?? [];
  const categories = useCategories();
  const currencyRows = useCurrencyRows();
  const currencies = currencyRows ?? [];

  const [fields, setFields] = useState<PlannedFields>(() => item?.fields ?? blankPlanned());
  const [edited, setEdited] = useState(false);
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  // What the user chose themselves: a payee's history never overwrites those.
  // The default account a new one starts with isn't a choice, so history may replace it.
  const [chosen, setChosen] = useState<{ category: boolean; account: boolean }>(() => ({
    category: !!item?.fields.categoryName,
    account: !!item,
  }));

  // A new one starts from capture's defaults: the default account and currency.
  useEffect(() => {
    if (!isNew) return;
    let live = true;
    void (async () => {
      const [accountId, currency, currencyRowsNow] = await Promise.all([
        getDefaultSourceAccountId(db),
        getDefaultCurrencyCode(db),
        db.select().from(referenceCurrencies),
      ]);
      if (live) {
        setFields((f) => ({
          ...f,
          sourceId: f.sourceId ?? accountId,
          currencyCode: f.currencyCode || currency || primaryCurrencyCode(currencyRowsNow) || '',
        }));
      }
    })();
    return () => {
      live = false;
    };
  }, [isNew, db]);

  const payeeType = fields.type === 'deposit' ? 'deposit' : 'withdrawal';
  const histories = useMerchantHistories(payeeType);

  const set = (patch: Partial<PlannedFields>) => {
    setEdited(true);
    setFields((f) => ({ ...f, ...patch }));
  };

  const currency = currencyOf(currencies, fields.currencyCode);
  const problems = plannedProblems(fields);

  const accountName = (id: string | null, name: string | null) =>
    (id ? (assetAccounts.find((a) => a.id === id)?.name ?? name) : name) ?? '—';

  // Which end is the user's own account and which the payee/payer.
  const ownFrom = fields.type !== 'deposit';
  const ownTo = fields.type !== 'withdrawal';
  const fromText =
    (ownFrom ? accountName(fields.sourceId, fields.sourceName) : fields.sourceName) ?? '—';
  const toText =
    (ownTo ? accountName(fields.destinationId, fields.destinationName) : fields.destinationName) ??
    '—';

  /**
   * A payee picked from history also fills what's usually booked with it — its category and the
   * account it's usually paid from — where the user hasn't chosen one.
   */
  function choosePayee(h: MerchantHistory) {
    const patch: Partial<PlannedFields> =
      fields.type === 'deposit'
        ? { sourceName: h.displayName, sourceId: null }
        : { destinationName: h.displayName, destinationId: null };
    if (!chosen.category && !fields.categoryName && h.topCategory) {
      patch.categoryName = h.topCategory;
    }
    const account =
      !chosen.account && h.topAccountName
        ? assetAccounts.find((a) => a.name === h.topAccountName)
        : undefined;
    if (account) {
      if (fields.type === 'deposit') {
        patch.destinationId = account.id;
        patch.destinationName = account.name;
      } else {
        patch.sourceId = account.id;
        patch.sourceName = account.name;
      }
    }
    set(patch);
  }

  /** The own account moves to the end the new type keeps it on; the payee/payer starts empty. */
  function changeType(type: PlannedFields['type']) {
    if (type === fields.type) return;
    const own = ownFrom
      ? { id: fields.sourceId, name: fields.sourceName }
      : { id: fields.destinationId, name: fields.destinationName };
    const none = { id: null, name: null };
    const source = type === 'deposit' ? none : own;
    const destination = type === 'withdrawal' ? none : type === 'deposit' ? own : none;
    set({
      type,
      sourceId: source.id,
      sourceName: source.name,
      destinationId: destination.id,
      destinationName: destination.name,
    });
  }

  const next: PlannedFields = {
    ...fields,
    name: fields.name.trim(),
    tags: fields.tags,
  };
  const unchanged = !!item && samePlannedFields(item.fields, next);
  const dirty = !!item && !unchanged;

  return {
    fields,
    setFields,
    set,
    edited,
    setEdited,
    sheet,
    setSheet,
    scheduleOpen,
    setScheduleOpen,
    chosen,
    setChosen,
    choosePayee,
    changeType,
    payeeType,
    histories,
    currency,
    currencyRows,
    currencies,
    assetAccounts,
    categories,
    problems,
    accountName,
    ownFrom,
    ownTo,
    fromText,
    toText,
    next,
    unchanged,
    dirty,
    isNew,
  };
}

export type PlannedForm = ReturnType<typeof usePlannedForm>;
