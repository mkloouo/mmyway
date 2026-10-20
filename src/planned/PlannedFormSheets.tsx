import { useTranslation } from 'react-i18next';
import { ScheduleSheet } from '../ui/ScheduleSheet';
import { AmountSheet } from '../ui/AmountSheet';
import { PickerSheet } from '../ui/PickerSheet';
import { AccountPickerSheet } from '../ui/AccountPickerSheet';
import { PayeeSheet } from '../ui/PayeeSheet';
import { pickableCurrencies } from '../money/currencies';
import { REMIND_CHOICES } from './remind';
import type { PlannedForm } from './usePlannedForm';
import type { PlannedGroup } from './model';
import type { ReminderWhen } from '../settings/appSettings';

/**
 * Shared sheet wiring for Planned form editor: Schedule, Amount, Currency,
 * Accounts, Payee, Category, and Remind sheets.
 */
export function PlannedFormSheets({
  form,
  group,
  remind,
  onChooseRemind,
}: {
  form: PlannedForm;
  group?: PlannedGroup | null;
  remind: { override: ReminderWhen | 'off' | null; when: ReminderWhen } | null;
  onChooseRemind: (key: string) => void;
}) {
  const { t: tr } = useTranslation();
  const {
    sheet,
    setSheet,
    scheduleOpen,
    setScheduleOpen,
    fields,
    set,
    setChosen,
    currency,
    currencies,
    assetAccounts,
    categories,
    histories,
    choosePayee,
  } = form;

  return (
    <>
      <ScheduleSheet
        visible={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        group={group}
        repeats={fields.repeats}
        repetitions={fields.repetitions}
        end={fields.end}
        date={fields.date}
        onChange={set}
      />
      <AmountSheet
        visible={sheet === 'amount'}
        title={tr('fields.amount')}
        initial={fields.amount}
        currency={currency}
        type={fields.type}
        onDone={(typed) => {
          if (typed !== null) set({ amount: typed });
          setSheet(null);
        }}
      />
      <PickerSheet
        visible={sheet === 'currency'}
        onClose={() => setSheet(null)}
        title={tr('fields.currency')}
        options={pickableCurrencies(currencies, fields.currencyCode).map((c) => ({
          key: c.code,
          label: c.code,
        }))}
        selected={fields.currencyCode}
        onSelect={(code) => code && set({ currencyCode: code })}
      />
      <AccountPickerSheet
        visible={sheet === 'own' || sheet === 'ownTo'}
        onClose={() => setSheet(null)}
        title={sheet === 'ownTo' ? tr('fields.to') : tr('fields.from')}
        accounts={assetAccounts}
        currencies={currencies}
        selectedId={sheet === 'ownTo' ? fields.destinationId : fields.sourceId}
        onSelect={(a) => {
          setChosen((c) => ({ ...c, account: true }));
          set(
            sheet === 'ownTo'
              ? { destinationId: a.id, destinationName: a.name }
              : { sourceId: a.id, sourceName: a.name },
          );
        }}
      />
      <PayeeSheet
        visible={sheet === 'payee'}
        onClose={() => setSheet(null)}
        histories={histories}
        payeeLabel={fields.type === 'deposit' ? 'payer' : 'payee'}
        onSelect={choosePayee}
        onCreateNew={(text) =>
          set(
            fields.type === 'deposit'
              ? { sourceName: text, sourceId: null }
              : { destinationName: text, destinationId: null },
          )
        }
      />
      <PickerSheet
        visible={sheet === 'category'}
        onClose={() => setSheet(null)}
        title={tr('fields.category')}
        options={categories.map((c) => ({ key: c.name, label: c.name }))}
        selected={fields.categoryName}
        onSelect={(categoryName) => {
          setChosen((c) => ({ ...c, category: true }));
          set({ categoryName: categoryName || null });
        }}
        noneLabel={tr('common.none')}
      />
      <PickerSheet
        visible={sheet === 'remind'}
        onClose={() => setSheet(null)}
        title={tr('planned.remind.title')}
        options={[
          {
            key: 'default',
            label: tr('planned.remind.default', {
              when: tr(`planned.remind.${remind?.when ?? 'dayBefore'}`),
            }),
          },
          ...REMIND_CHOICES.map((k) => ({
            key: k,
            label: tr(`planned.remind.${k}`),
          })),
        ]}
        selected={remind?.override ?? 'default'}
        onSelect={(key) => {
          if (!key) return;
          onChooseRemind(key);
        }}
      />
    </>
  );
}
