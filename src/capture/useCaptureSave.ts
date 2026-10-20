import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OutboxDb } from '../sync/outbox';
import type { DisplayCurrency } from '../money/format';
import { formatAmountInput } from '../money/format';
import { createManualEntry, confirmInboxItem, undoConfirm } from '../inbox/createManualEntry';
import { attachReceiptImage } from '../inbox/updateDraft';
import { draftReadiness, type DraftReadiness } from '../inbox/readiness';
import { buildManualEntryInput, type CaptureFormState } from './buildManualEntryInput';
import type { AccountPickerAccount } from '../accounts/useAssetAccounts';
import type { Draft } from '../inbox/draft';
import { recentPosition } from './position';
import { TX_TYPES } from '../transactions/txTypes';

function labelKeyForType(t: Draft['type']): string {
  return TX_TYPES.find((x) => x.type === t)!.labelKey;
}

export interface CaptureSnackbar {
  id: string;
  message: string;
  actionLabel: string;
  onAction: () => void;
}

export interface UseCaptureSaveParams {
  db: OutboxDb;
  assetAccounts: AccountPickerAccount[];
  currency: DisplayCurrency;
  effectiveCurrencyCode: string;
  effectiveSourceId: string | null;
  sourceAccount: AccountPickerAccount | undefined;
  destinationAccount: AccountPickerAccount | undefined;
  type: 'withdrawal' | 'deposit' | 'transfer';
  amount: string;
  date: Date;
  dateMode: 'today' | 'yesterday' | 'custom';
  description: string;
  merchantRawInput: string;
  forceNewPayee: boolean;
  destinationId: string | null;
  categoryName: string | null;
  budgetId: string | null;
  notes: string;
  tags: string[];
  sharedWith: string;
  photoUri: string | null;
  showFx: boolean;
  accountCurrencyCode: string | null;
  parsedForeignAmount: string;
  foreignAmountInvalid: boolean;
  fxMissing: boolean;
  isDirty: boolean;
  act: <A extends unknown[]>(
    action: string,
    fn: (...args: A) => Promise<void>,
    onError?: (message: string) => void,
  ) => (...args: A) => Promise<void>;
  isSaving: boolean;
  shake: () => void;
  fly: (amount: string) => void;
  onTick: () => void;
  onWarn: () => void;
  setToast: (msg: string) => void;
  markSaved: () => void;
}

export interface CaptureSaveState {
  readiness: DraftReadiness;
  blocks: (missing: string) => boolean;
  handleSave: (andConfirm: boolean) => void;
  snackbar: CaptureSnackbar | null;
  dismissSnackbar: () => void;
}

export function useCaptureSave({
  db,
  assetAccounts,
  currency,
  effectiveCurrencyCode,
  effectiveSourceId,
  sourceAccount,
  destinationAccount,
  type,
  amount,
  date,
  dateMode,
  description,
  merchantRawInput,
  forceNewPayee,
  destinationId,
  categoryName,
  budgetId,
  notes,
  tags,
  sharedWith,
  photoUri,
  showFx,
  accountCurrencyCode,
  parsedForeignAmount,
  foreignAmountInvalid,
  fxMissing,
  isDirty,
  act,
  isSaving,
  shake,
  fly,
  onTick,
  onWarn,
  setToast,
  markSaved,
}: UseCaptureSaveParams): CaptureSaveState {
  const { t: tr } = useTranslation();
  const [snackbar, setSnackbar] = useState<CaptureSnackbar | null>(null);
  const dismissSnackbar = useCallback(() => setSnackbar(null), []);

  const previewDraft: Draft = useMemo(
    () => ({
      type,
      amount,
      currencyCode: effectiveCurrencyCode,
      date: date.toISOString(),
      description: description || merchantRawInput || type,
      isNewPayee: forceNewPayee,
      sourceId: effectiveSourceId ?? undefined,
      sourceName: type === 'deposit' ? merchantRawInput : sourceAccount?.name,
      destinationId: destinationId ?? undefined,
      destinationName: type === 'withdrawal' ? merchantRawInput : destinationAccount?.name,
      categoryName: categoryName ?? undefined,
      budgetId: budgetId ?? undefined,
    }),
    [
      type,
      amount,
      effectiveCurrencyCode,
      date,
      description,
      merchantRawInput,
      forceNewPayee,
      effectiveSourceId,
      sourceAccount?.name,
      destinationId,
      destinationAccount?.name,
      categoryName,
      budgetId,
    ],
  );

  const readiness = draftReadiness(previewDraft);
  const blocks = useCallback(
    (missing: string) => isDirty && readiness.missing.includes(missing),
    [isDirty, readiness.missing],
  );

  const formState: CaptureFormState = useMemo(
    () => ({
      type,
      amount,
      currencyCode: effectiveCurrencyCode,
      date: dateMode === 'today' ? new Date() : date,
      description,
      merchantRawInput,
      forceNewPayee,
      sourceId: effectiveSourceId,
      destinationId,
      categoryName,
      budgetId,
      notes,
      tags,
      sharedWith,
      foreignAmount: showFx ? parsedForeignAmount : '',
      foreignCurrencyCode: showFx ? (accountCurrencyCode ?? null) : null,
      location: recentPosition(),
    }),
    [
      type,
      amount,
      effectiveCurrencyCode,
      dateMode,
      date,
      description,
      merchantRawInput,
      forceNewPayee,
      effectiveSourceId,
      destinationId,
      categoryName,
      budgetId,
      notes,
      tags,
      sharedWith,
      showFx,
      parsedForeignAmount,
      accountCurrencyCode,
    ],
  );

  const undoSend = act(
    tr('common.undo'),
    async (inboxItemId: string, confirmed: Awaited<ReturnType<typeof confirmInboxItem>>) => {
      const outcome = await undoConfirm(db, inboxItemId, confirmed);
      setToast(outcome === 'undone' ? tr('capture.undoneBackInInbox') : tr('inbox.alreadySent'));
    },
  );

  const save = act(
    tr('common.save'),
    async (andConfirm: boolean) => {
      const input = buildManualEntryInput(formState, assetAccounts);
      const { inboxItemId } = await createManualEntry(db, input);
      if (photoUri) await attachReceiptImage(db, inboxItemId, photoUri);
      const label =
        formState.merchantRawInput || formState.description || tr(labelKeyForType(formState.type));
      onTick();
      fly(formatAmountInput(amount, currency));
      if (andConfirm) {
        const confirmed = await confirmInboxItem(db, inboxItemId);
        setSnackbar({
          id: inboxItemId,
          message: tr('capture.confirmedLabel', { label }),
          actionLabel: tr('common.undo'),
          onAction: () => void undoSend(inboxItemId, confirmed),
        });
      } else {
        setToast(tr('capture.savedLabel', { label }));
      }
      markSaved();
    },
    (msg: string) => setToast(msg),
  );

  const handleSave = (andConfirm: boolean) => {
    if (foreignAmountInvalid || fxMissing || isSaving) return;
    if (andConfirm && !readiness.ready) {
      onWarn();
      shake();
      return;
    }
    void save(andConfirm);
  };

  return {
    readiness,
    blocks,
    handleSave,
    snackbar,
    dismissSnackbar,
  };
}
