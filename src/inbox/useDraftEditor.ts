import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { OutboxDb } from '../sync/outbox';
import type { Draft, DraftSplit } from './draft';
import type { AccountPickerAccount } from '../accounts/useAssetAccounts';
import { rewireForType, type TxEnds } from '../transactions/changeType';
import { updateDraft, deleteInboxItem, removeReceiptImage, retryErroredItem } from './updateDraft';
import { confirmInboxItem } from './createManualEntry';
import { rememberPayeeAlias, removePayeeAlias } from '../lookup/aliases';
import { requestSync } from '../sync/syncTrigger';
import { discardOperation } from '../sync/outbox';
import { getClient } from '../api/ff3/session';
import { alertDiscardOutcome } from './discardAlert';
import { patchExtraSplit } from './draftSplits';
import { generateId } from '../utils/id';
import { errorMessage } from '../utils/errorMessage';
import { logLine } from '../utils/log';

export interface DraftDetailChange {
  categoryName?: string | null;
  sourceAccountId?: string | null;
  destinationAccountId?: string | null;
  budgetId?: string | null;
  notes?: string | null;
  tags?: string[] | null;
  sharedWith?: string | null;
}

export interface UseDraftEditorParams {
  db: OutboxDb;
  id: string;
  draft: Draft;
  assetAccounts: AccountPickerAccount[];
  payeeName: string | undefined;
  readinessReady: boolean;
  pendingCreateId: string | null;
  act: <A extends unknown[]>(
    action: string,
    fn: (...args: A) => Promise<void>,
    onError?: (message: string) => void,
  ) => (...args: A) => Promise<void>;
  shake: () => void;
  onTick: () => void;
  onWarn: () => void;
  onCloseSheet: () => void;
  onBack: () => void;
  confirmDestructive: (title: string, action: string, body?: string) => Promise<boolean>;
  setSnackbar: (entry: {
    id: string;
    message: string;
    actionLabel?: string;
    onAction?: () => void;
  }) => void;
}

export function useDraftEditor({
  db,
  id,
  draft,
  assetAccounts,
  payeeName,
  readinessReady,
  pendingCreateId,
  act,
  shake,
  onTick,
  onWarn,
  onCloseSheet,
  onBack,
  confirmDestructive,
  setSnackbar,
}: UseDraftEditorParams) {
  const { t: tr } = useTranslation();

  const patch = useCallback(
    (fields: Partial<Draft>) => {
      const next =
        'sourceId' in fields || 'destinationId' in fields || 'currencyCode' in fields
          ? { foreignAmount: undefined, foreignCurrencyCode: undefined, ...fields }
          : fields;
      updateDraft(db, id, next).catch((err) => {
        logLine('warn', `save draft failed: ${errorMessage(err)}`);
        setSnackbar({ id: generateId(), message: tr('common.saveFailed') });
      });
    },
    [db, id, setSnackbar, tr],
  );

  const choosePayee = act(tr('capture.payee'), async (d: Draft, name: string, isNew: boolean) => {
    const raw = d.payeeReadAs ?? (d.isNewPayee ? payeeName : undefined);
    const learned = raw ? await rememberPayeeAlias(db, raw, name) : false;
    patch(
      d.type === 'deposit'
        ? {
            sourceName: name,
            sourceId: undefined,
            isNewPayee: isNew,
            payeeReadAs: learned ? raw : undefined,
          }
        : {
            destinationName: name,
            destinationId: undefined,
            isNewPayee: isNew,
            payeeReadAs: learned ? raw : undefined,
          },
    );
    if (!learned || !raw) return;
    setSnackbar({
      id: generateId(),
      message: tr('draft.willBookTo', { raw, name }),
      actionLabel: tr('common.undo'),
      onAction: () => {
        void removePayeeAlias(db, raw);
      },
    });
  });

  const handleDetailChange = useCallback(
    (change: DraftDetailChange) => {
      const draftPatch: Partial<Draft> = {};
      if ('categoryName' in change) draftPatch.categoryName = change.categoryName ?? undefined;
      if ('sourceAccountId' in change) {
        draftPatch.sourceId = change.sourceAccountId ?? undefined;
        if (
          (!draft.amount || draft.amount === '0') &&
          change.sourceAccountId &&
          draft.type !== 'deposit'
        ) {
          const acc = assetAccounts.find((a) => a.id === change.sourceAccountId);
          if (acc?.currencyCode) {
            draftPatch.currencyCode = acc.currencyCode;
          }
        }
      }
      if ('destinationAccountId' in change) {
        draftPatch.destinationId = change.destinationAccountId ?? undefined;
        if (
          (!draft.amount || draft.amount === '0') &&
          change.destinationAccountId &&
          draft.type === 'deposit'
        ) {
          const acc = assetAccounts.find((a) => a.id === change.destinationAccountId);
          if (acc?.currencyCode) {
            draftPatch.currencyCode = acc.currencyCode;
          }
        }
      }
      if ('budgetId' in change) draftPatch.budgetId = change.budgetId ?? undefined;
      if ('notes' in change) draftPatch.notes = change.notes ?? undefined;
      if ('tags' in change) draftPatch.extraTags = change.tags ?? [];
      if ('sharedWith' in change) draftPatch.sharedWith = change.sharedWith ?? undefined;
      patch(draftPatch);
    },
    [assetAccounts, draft.amount, draft.type, patch],
  );

  const handleExtraDetailChange = useCallback(
    (index: number, change: DraftDetailChange) => {
      const own: Partial<DraftSplit> = {};
      const shared: Partial<Draft> = {};
      if ('categoryName' in change) own.categoryName = change.categoryName ?? undefined;
      if ('budgetId' in change) own.budgetId = change.budgetId ?? undefined;
      if ('notes' in change) own.notes = change.notes ?? undefined;
      if ('tags' in change) own.extraTags = change.tags ?? [];
      if ('sharedWith' in change) own.sharedWith = change.sharedWith ?? undefined;
      if ('sourceAccountId' in change) shared.sourceId = change.sourceAccountId ?? undefined;
      if ('destinationAccountId' in change)
        shared.destinationId = change.destinationAccountId ?? undefined;
      patch({
        ...shared,
        ...(Object.keys(own).length ? patchExtraSplit(draft, index - 1, own) : {}),
      });
    },
    [draft, patch],
  );

  const handleTypeChange = useCallback(
    (newType: 'withdrawal' | 'deposit' | 'transfer') => {
      if (newType === draft.type) return;
      const ends: TxEnds = {
        sourceId: draft.sourceId ?? null,
        sourceName: draft.type === 'deposit' ? (draft.sourceName ?? null) : null,
        destinationId: draft.destinationId ?? null,
        destinationName: draft.type === 'withdrawal' ? (draft.destinationName ?? null) : null,
      };
      const rewired = rewireForType(draft.type, newType, ends);
      patch({
        type: newType,
        sourceId: rewired.source_id ?? undefined,
        destinationId: rewired.destination_id ?? undefined,
        sourceName: rewired.source_name ?? undefined,
        destinationName: rewired.destination_name ?? undefined,
        budgetId: newType === 'transfer' ? undefined : draft.budgetId,
      });
    },
    [
      draft.budgetId,
      draft.destinationId,
      draft.destinationName,
      draft.sourceId,
      draft.sourceName,
      draft.type,
      patch,
    ],
  );

  const handleConfirm = act(tr('inbox.confirm'), async () => {
    if (!readinessReady) {
      onWarn();
      shake();
      return;
    }
    await confirmInboxItem(db, id);
    onTick();
    onBack();
  });

  const retryError = act(tr('inbox.retry'), async () => {
    await retryErroredItem(db, id);
    requestSync();
  });

  const handleDeleteDraft = act(tr('common.delete'), async () => {
    onCloseSheet();
    const ok = await confirmDestructive(
      tr('draft.deleteTitle'),
      tr('common.delete'),
      tr('draft.deleteBody'),
    );
    if (!ok) return;
    await deleteInboxItem(db, id);
    onBack();
  });

  const removePhoto = act(tr('capture.removePhoto'), async () => {
    const empty = !draft.description.trim() && !draft.amount;
    const ok = await confirmDestructive(
      tr('draft.removePhotoTitle'),
      tr('capture.removePhoto'),
      empty ? tr('draft.removePhotoEmpty') : undefined,
    );
    if (!ok) return;
    onCloseSheet();
    await removeReceiptImage(db, id);
  });

  const cancelSending = act(tr('draft.cancelSending'), async () => {
    if (!pendingCreateId) return;
    alertDiscardOutcome(await discardOperation(db, pendingCreateId, () => getClient(db)));
  });

  return {
    patch,
    choosePayee,
    handleDetailChange,
    handleExtraDetailChange,
    handleTypeChange,
    handleConfirm,
    retryError,
    handleDeleteDraft,
    removePhoto,
    cancelSending,
  };
}
