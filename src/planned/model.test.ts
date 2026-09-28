import { billBody, fieldsOf, groupPlanned, recurrenceBody, repetitionFor, ruleBody, type PlannedFields } from './model';
import { plannedItems } from './items';
import type { PlannedObject } from './objects';

const bill: PlannedObject = {
  key: 'bill:1', kind: 'bill', id: '1', name: 'Spotify',
  attributes: { name: 'Spotify', amount_min: '7.99', amount_max: '7.99', currency_code: 'USD', date: '2026-01-05', repeat_freq: 'monthly', skip: 0 },
};
const rule: PlannedObject = {
  key: 'rule:2', kind: 'rule', id: '2', name: 'spotify',
  attributes: {
    title: 'spotify',
    triggers: [{ type: 'description_contains', value: 'Spotify' }, { type: 'amount_less', value: '50' }],
    actions: [{ type: 'set_category', value: 'Music' }, { type: 'set_budget', value: 'Fun' }],
  },
};
const recurrence: PlannedObject = {
  key: 'recurrence:3', kind: 'recurrence', id: '3', name: 'Spotify',
  attributes: {
    title: 'Spotify', type: 'withdrawal', first_date: '2026-01-05', nr_of_repetitions: null,
    repetitions: [{ id: '9', type: 'monthly', moment: '5', skip: 0, occurrences: ['2026-10-05T00:00:00+02:00'] }],
    transactions: [{ id: '7', amount: '7.99', currency_code: 'USD', source_id: '1', destination_name: 'Spotify', category_name: 'Music', tags: ['sub'] }],
  },
};

describe('planned model', () => {
  it('groups the three objects by name, ignoring case', () => {
    const [group] = groupPlanned([bill, rule, recurrence]);
    expect(group).toMatchObject({ name: 'Spotify', bill: { id: '1' }, rule: { id: '2' }, recurrence: { id: '3' } });
  });

  it('reads one set of fields from them', () => {
    const fields = fieldsOf(groupPlanned([bill, rule, recurrence])[0]!, '2026-09-28');
    expect(fields).toMatchObject({
      name: 'Spotify', amount: '7.99', currencyCode: 'USD', sourceId: '1', destinationName: 'Spotify',
      categoryName: 'Music', tags: ['sub'], repeats: true, frequency: 'monthly', every: 1, date: '2026-10-05',
    });
  });

  it('leaves the schedule alone when it did not change', () => {
    const fields = fieldsOf(groupPlanned([bill, rule, recurrence])[0]!, '2026-09-28');
    const renamed: PlannedFields = { ...fields, name: 'Spotify Family', amount: '12.99' };
    expect(billBody(renamed, fields)).not.toHaveProperty('date');
    expect(recurrenceBody({ ...renamed, sourceId: '1', destinationId: '4' }, fields, { billId: '1', transactionId: '7' })).not.toHaveProperty('repetitions');
    expect(billBody({ ...renamed, date: '2026-10-07' }, fields)).toMatchObject({ date: '2026-10-07', repeat_freq: 'monthly', skip: 0 });
  });

  it('keeps a rule’s own triggers and actions, renaming the old name', () => {
    const fields = fieldsOf(groupPlanned([bill, rule, recurrence])[0]!, '2026-09-28');
    const body = ruleBody({ ...fields, name: 'Spotify Family', categoryName: 'Media' }, rule.attributes as never, 'Spotify', null);
    expect(body.triggers).toEqual([
      expect.objectContaining({ type: 'description_contains', value: 'Spotify Family' }),
      expect.objectContaining({ type: 'amount_less', value: '50' }),
    ]);
    expect(body.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'set_budget', value: 'Fun' }),
      expect.objectContaining({ type: 'set_category', value: 'Media' }),
      expect.objectContaining({ type: 'link_to_bill', value: 'Spotify Family' }),
    ]));
    expect((body.actions as { type: string }[]).filter((a) => a.type === 'set_category')).toHaveLength(1);
  });

  it('sends either a repetition count or an end date, never both', () => {
    const fields = { ...fieldsOf(groupPlanned([bill, rule, recurrence])[0]!, '2026-09-28'), sourceId: '1', destinationId: '4' };
    const once = recurrenceBody({ ...fields, repeats: false }, null, {});
    expect(once).toMatchObject({ nr_of_repetitions: 1 });
    expect(once).not.toHaveProperty('repeat_until');
    const repeating = recurrenceBody({ ...fields, repeats: true }, null, {});
    expect(repeating).toMatchObject({ repeat_until: '2099-12-31' });
    expect(repeating).not.toHaveProperty('nr_of_repetitions');
  });

  it('sends accounts and the category by id, never by name', () => {
    const fields = fieldsOf(groupPlanned([bill, rule, recurrence])[0]!, '2026-09-28');
    const body = recurrenceBody({ ...fields, sourceId: '1', destinationId: '4' }, null, { categoryId: '12' });
    const [transaction] = body.transactions as Record<string, unknown>[];
    expect(transaction).toMatchObject({ source_id: '1', destination_id: '4', category_id: '12' });
    expect(transaction).not.toHaveProperty('destination_name');
    expect(transaction).not.toHaveProperty('category_name');
    expect((recurrenceBody({ ...fields, sourceId: '1', destinationId: '4' }, null, {}).transactions as Record<string, unknown>[])[0]).toMatchObject({ category_id: null });
  });

  it('maps frequencies to recurrence repetitions', () => {
    const f = { date: '2026-09-28', every: 1 } as PlannedFields;
    expect(repetitionFor({ ...f, frequency: 'weekly' })).toMatchObject({ type: 'weekly', moment: '1', skip: 0 });
    expect(repetitionFor({ ...f, frequency: 'quarterly' })).toMatchObject({ type: 'monthly', moment: '28', skip: 2 });
    expect(repetitionFor({ ...f, frequency: 'yearly', every: 2 })).toMatchObject({ type: 'yearly', moment: '2026-09-28', skip: 1 });
  });

  it('shows queued saves and hides queued deletes', () => {
    const fields = fieldsOf(groupPlanned([bill, rule, recurrence])[0]!, '2026-09-28');
    const saved = plannedItems([bill, rule, recurrence], [
      { kind: 'save_planned', sequence: 1, payloadJson: JSON.stringify({ key: 'spotify', billId: '1', fields: { ...fields, amount: '9.99' } }) },
    ], '2026-09-28');
    expect(saved[0]).toMatchObject({ queued: true, fields: { amount: '9.99' } });
    const deleted = plannedItems([bill, rule, recurrence], [
      { kind: 'delete_planned', sequence: 1, payloadJson: JSON.stringify({ key: 'spotify', name: 'Spotify', billId: '1' }) },
    ], '2026-09-28');
    expect(deleted).toHaveLength(0);
  });

  it('lists only complete trios, unless a queued save is completing one', () => {
    expect(plannedItems([bill, rule, recurrence], [], '2026-09-28')).toHaveLength(1);
    expect(plannedItems([bill, rule], [], '2026-09-28')).toHaveLength(0);
    expect(plannedItems([recurrence], [], '2026-09-28')).toHaveLength(0);
    const fields = fieldsOf(groupPlanned([bill])[0]!, '2026-09-28');
    const saving = plannedItems([bill], [
      { kind: 'save_planned', sequence: 1, payloadJson: JSON.stringify({ key: 'spotify', billId: '1', fields }) },
    ], '2026-09-28');
    expect(saving).toHaveLength(1);
  });
});
