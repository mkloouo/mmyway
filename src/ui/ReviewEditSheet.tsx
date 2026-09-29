// The Inbox's edit sheet for a recurring transaction FF3 booked: what was actually charged, and
// from which account. The currency follows the account, so there is nothing to type for it.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';
import { AccountPickerSheet } from './AccountPickerSheet';
import { Button, Sheet } from './components';
import { TextField } from './TextField';
import { useTheme } from './theme';
import { currencyOf, formatMoney } from './money';
import { useAction } from './useAction';
import { useDb } from '../providers/DbProvider';
import { parseDecimalInput, trimDecimal } from '../api/ff3/decimal';
import { readReviewJournal, reviewForeign } from '../inbox/draftJson';
import { editRecurringReview } from '../sync/recurringReview';
import type { InboxItemRow } from '../inbox/useInboxSections';
import type { ReferenceAccountRow } from '../accounts/useAssetAccounts';

export interface ReviewEdit {
  id: string;
  amount: string;
  currencyCode: string;
  accountId: string | null;
  foreign: { amount: string; currencyCode: string } | null;
}

/** The state the Inbox holds while this sheet is open; null when it is closed. */
export function reviewEditFor(item: InboxItemRow): ReviewEdit {
  const journal = readReviewJournal(item.draftJson);
  const foreign = reviewForeign(journal);
  // FF3 booked the planned 7.99 USD as 7.99 PLN — that number isn't the charge, so start empty.
  const amount =
    foreign && journal.amount && trimDecimal(journal.amount) === trimDecimal(foreign.amount)
      ? ''
      : trimDecimal(journal.amount ?? '');
  return {
    id: item.id,
    amount,
    currencyCode: journal.currency_code ?? '',
    accountId: journal.source_id ?? null,
    foreign,
  };
}

export function ReviewEditSheet({
  edit,
  onChange,
  onClose,
  accounts,
  currencies,
  onError,
}: {
  edit: ReviewEdit | null;
  onChange: (next: ReviewEdit) => void;
  onClose: () => void;
  accounts: ReferenceAccountRow[];
  currencies: { code: string; symbol: string; decimalPlaces: number }[];
  onError: (message: string) => void;
}) {
  const t = useTheme();
  const { t: tr } = useTranslation();
  const db = useDb();
  const act = useAction();
  const [pickingAccount, setPickingAccount] = useState(false);

  const account = edit ? accounts.find((a) => a.id === edit.accountId) : undefined;
  // The currency is the account's: picking another account changes it.
  const currencyCode = account?.currencyCode ?? edit?.currencyCode ?? '';
  const foreign = edit?.foreign && edit.foreign.currencyCode !== currencyCode ? edit.foreign : null;
  const amountResult = edit ? parseDecimalInput(edit.amount) : null;
  const amountInvalid = !!edit?.amount && !!amountResult && !amountResult.ok;

  // A double-tap here used to enqueue two recurring_review operations; `act` drops the second.
  const save = act(
    tr('common.save'),
    async () => {
      if (!edit || !amountResult?.ok) return;
      await editRecurringReview(db, edit.id, {
        amount: amountResult.value,
        currency_code: currencyCode,
        ...(edit.accountId ? { source_id: edit.accountId } : {}),
        ...(foreign
          ? { foreign_amount: foreign.amount, foreign_currency_code: foreign.currencyCode }
          : {}),
      });
      onClose();
    },
    onError,
  );
  const saving = act.pending(tr('common.save'));

  return (
    <>
      <Sheet
        visible={!!edit}
        onClose={onClose}
        title={tr('inbox.editReviewTitle')}
        footer={
          <Button
            title={saving ? tr('common.saving') : tr('inbox.saveAndApprove')}
            disabled={saving || !amountResult?.ok}
            onPress={save}
          />
        }
      >
        {!!edit && (
          <>
            {foreign && (
              <Text style={[t.type.body, { color: t.color.text }]}>
                {tr('inbox.chargedAs', {
                  amount: formatMoney(foreign.amount, currencyOf(currencies, foreign.currencyCode)),
                })}
              </Text>
            )}
            <TextField
              placeholder={`${tr('fields.amount')}, ${currencyCode}`}
              value={edit.amount}
              keyboardType="decimal-pad"
              autoFocus={!!foreign}
              invalid={amountInvalid}
              onChangeText={(amount) => onChange({ ...edit, amount })}
            />
            {amountInvalid && (
              <Text style={[t.type.label, { color: t.color.danger }]}>
                {tr('common.invalidAmount')}
              </Text>
            )}
            <Button
              title={account?.name ?? tr('fields.from')}
              variant="secondary"
              onPress={() => setPickingAccount(true)}
            />
          </>
        )}
      </Sheet>
      <AccountPickerSheet
        visible={pickingAccount}
        onClose={() => setPickingAccount(false)}
        title={tr('fields.from')}
        accounts={accounts}
        currencies={currencies}
        onSelect={(a) => edit && onChange({ ...edit, accountId: a.id })}
      />
    </>
  );
}
