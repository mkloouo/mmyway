// The Inbox's edit sheet for a recurring transaction FF3 booked: what was actually charged, and
// the user's own account it moved: From for an expense, To for an income, both for a transfer.
// The currency follows the account the amount is in, so there is nothing to type for it.
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
import { readReviewJournal, reviewForeign, reviewType } from '../inbox/draftJson';
import { editRecurringReview } from '../sync/recurringReview';
import type { InboxItemRow } from '../inbox/useInboxSections';
import type { ReferenceAccountRow } from '../accounts/useAssetAccounts';

export interface ReviewEdit {
  id: string;
  type: 'withdrawal' | 'deposit' | 'transfer';
  amount: string;
  currencyCode: string;
  /** Only the ends that are the user's own accounts are offered: never an income's payer. */
  sourceId: string | null;
  destinationId: string | null;
  /** Firefly III's names for the two ends, for an account the picker doesn't list (a loan). */
  sourceName: string | null;
  destinationName: string | null;
  foreign: { amount: string; currencyCode: string } | null;
}

type End = 'source' | 'destination';

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
    type: reviewType(journal),
    amount,
    currencyCode: journal.currency_code ?? '',
    sourceId: journal.source_id ?? null,
    destinationId: journal.destination_id ?? null,
    sourceName: journal.source_name ?? null,
    destinationName: journal.destination_name ?? null,
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
  const [pickingAccount, setPickingAccount] = useState<End | null>(null);

  // An expense moves money out of its source, an income into its destination; a transfer both.
  const ends: End[] = !edit
    ? []
    : edit.type === 'transfer'
      ? ['source', 'destination']
      : edit.type === 'deposit'
        ? ['destination']
        : ['source'];
  const accountAt = (end: End) =>
    edit
      ? accounts.find((a) => a.id === (end === 'source' ? edit.sourceId : edit.destinationId))
      : undefined;
  // The currency is the account's the amount is in (an income's destination, else the source):
  // picking another account changes it.
  const currencyCode =
    accountAt(edit?.type === 'deposit' ? 'destination' : 'source')?.currencyCode ??
    edit?.currencyCode ??
    '';
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
        ...(ends.includes('source') && edit.sourceId ? { source_id: edit.sourceId } : {}),
        ...(ends.includes('destination') && edit.destinationId
          ? { destination_id: edit.destinationId }
          : {}),
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
            {ends.map((end) => (
              <Button
                key={end}
                title={
                  accountAt(end)?.name ??
                  (end === 'source' ? edit.sourceName : edit.destinationName) ??
                  (end === 'source' ? tr('fields.from') : tr('fields.to'))
                }
                variant="secondary"
                onPress={() => setPickingAccount(end)}
              />
            ))}
          </>
        )}
      </Sheet>
      <AccountPickerSheet
        visible={!!pickingAccount}
        onClose={() => setPickingAccount(null)}
        title={pickingAccount === 'destination' ? tr('fields.to') : tr('fields.from')}
        accounts={accounts}
        currencies={currencies}
        excludeId={
          edit?.type === 'transfer'
            ? pickingAccount === 'destination'
              ? edit.sourceId
              : edit.destinationId
            : null
        }
        onSelect={(a) =>
          edit &&
          onChange(
            pickingAccount === 'destination'
              ? { ...edit, destinationId: a.id, destinationName: a.name }
              : { ...edit, sourceId: a.id, sourceName: a.name },
          )
        }
      />
    </>
  );
}
