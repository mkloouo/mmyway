import {
  BILL_FOREVER_END,
  billBody,
  fieldsOf,
  groupPlanned,
  normalizeFields,
  recurrenceBody,
  ruleBody,
  samePlannedFields,
  scheduleChanged,
  type PlannedFields,
} from './model';
import { billSchedule, repetitionProblem, type Repetition } from './repetition';
import { plannedItems } from './items';
import type { PlannedObject } from './objects';

const bill: PlannedObject = {
  key: 'bill:1',
  kind: 'bill',
  id: '1',
  name: 'Spotify',
  attributes: {
    name: 'Spotify',
    amount_min: '7.99',
    amount_max: '7.99',
    currency_code: 'USD',
    date: '2026-01-05',
    repeat_freq: 'monthly',
    skip: 0,
  },
};
const rule: PlannedObject = {
  key: 'rule:2',
  kind: 'rule',
  id: '2',
  name: 'spotify',
  attributes: {
    title: 'spotify',
    triggers: [
      { type: 'description_contains', value: 'Spotify' },
      { type: 'amount_less', value: '50' },
    ],
    actions: [
      { type: 'set_category', value: 'Music' },
      { type: 'set_budget', value: 'Fun' },
    ],
  },
};
const recurrence: PlannedObject = {
  key: 'recurrence:3',
  kind: 'recurrence',
  id: '3',
  name: 'Spotify',
  attributes: {
    title: 'Spotify',
    type: 'withdrawal',
    first_date: '2026-01-05',
    nr_of_repetitions: null,
    repetitions: [
      {
        id: '9',
        type: 'monthly',
        moment: '5',
        skip: 0,
        occurrences: ['2026-10-05T00:00:00+02:00'],
      },
    ],
    transactions: [
      {
        id: '7',
        amount: '7.99',
        currency_code: 'USD',
        source_id: '1',
        destination_name: 'Spotify',
        category_name: 'Music',
        tags: ['sub'],
      },
    ],
  },
};

describe('planned model', () => {
  it('groups the three objects by name, ignoring case', () => {
    const [group] = groupPlanned([bill, rule, recurrence]);
    expect(group).toMatchObject({
      name: 'Spotify',
      bill: { id: '1' },
      rule: { id: '2' },
      recurrence: { id: '3' },
    });
  });

  it('reads one set of fields from them', () => {
    const fields = fieldsOf(groupPlanned([bill, rule, recurrence])[0]!, '2026-09-28');
    expect(fields).toMatchObject({
      name: 'Spotify',
      amount: '7.99',
      currencyCode: 'USD',
      sourceId: '1',
      destinationName: 'Spotify',
      categoryName: 'Music',
      tags: ['sub'],
      repeats: true,
      repetitions: [{ type: 'monthly', moment: '5', skip: 0, weekend: 1 }],
      end: { kind: 'forever' },
      date: '2026-10-05',
    });
  });

  it('leaves the schedule alone when it did not change', () => {
    const fields = fieldsOf(groupPlanned([bill, rule, recurrence])[0]!, '2026-09-28');
    const renamed: PlannedFields = { ...fields, name: 'Spotify Family', amount: '12.99' };
    expect(billBody(renamed, fields)).not.toHaveProperty('date');
    expect(
      recurrenceBody({ ...renamed, sourceId: '1', destinationId: '4' }, fields, {
        billId: '1',
        transactionId: '7',
      }),
    ).not.toHaveProperty('repetitions');
    expect(billBody({ ...renamed, date: '2026-10-07' }, fields)).toMatchObject({
      date: '2026-10-07',
      repeat_freq: 'monthly',
      skip: 0,
    });
  });

  it('pushes a repeating bill’s end date to the sentinel and ends a one-off the next day', () => {
    const fields = fieldsOf(groupPlanned([bill, rule, recurrence])[0]!, '2026-09-28');
    const moved: PlannedFields = { ...fields, date: '2026-11-08' };
    // FF3's bill update has no `nullable` on end_date and caps it at before:2038-01-17, so a
    // repeating one is pushed out of the way instead of cleared — which is how an end date left
    // behind by a one-off switched back to repeating goes away.
    expect(billBody(moved, fields)).toMatchObject({ end_date: BILL_FOREVER_END });
    expect(BILL_FOREVER_END < '2038-01-17').toBe(true);
    expect(billBody({ ...moved, repeats: false }, fields)).toMatchObject({
      end_date: '2026-11-09',
    });
  });

  it('keeps the note on the bill and only the time on the recurrence', () => {
    const fields = { ...fieldsOf(groupPlanned([bill, rule, recurrence])[0]!, '2026-09-28') };
    const blank: PlannedFields = { ...fields, notes: '', time: null };
    expect(billBody(blank, fields).notes).toBeNull();
    expect(
      recurrenceBody({ ...blank, sourceId: '1', destinationId: '4' }, fields, {}).notes,
    ).toBeNull();
    expect(
      recurrenceBody({ ...blank, time: '09:30', sourceId: '1', destinationId: '4' }, fields, {})
        .notes,
    ).toBe('mmyway-time: 09:30');
    const noted: PlannedFields = { ...fields, notes: 'Line one\nline two', time: '09:30' };
    expect(billBody(noted, fields).notes).toBe('Line one\nline two');
    expect(recurrenceBody({ ...noted, sourceId: '1', destinationId: '4' }, fields, {}).notes).toBe(
      'mmyway-time: 09:30',
    );
  });

  it('reads the note from the bill and the time from the recurrence', () => {
    const noted = { ...bill, attributes: { ...bill.attributes, notes: 'Line one\nline two' } };
    const glued = {
      ...recurrence,
      attributes: { ...recurrence.attributes, notes: 'Line oneline twommyway-time: 09:00' },
    } as PlannedObject;
    const both = fieldsOf(groupPlanned([noted as PlannedObject, rule, glued])[0]!, '2026-09-28');
    expect([both.notes, both.time]).toEqual(['Line one\nline two', '09:00']);
    const alone = fieldsOf(groupPlanned([glued])[0]!, '2026-09-28');
    expect([alone.notes, alone.time]).toEqual(['Line oneline two', '09:00']);
  });

  it('tells a planned transaction left as it was from an edited one', () => {
    const fields = fieldsOf(groupPlanned([bill, rule, recurrence])[0]!, '2026-09-28');
    expect(samePlannedFields(fields, { ...fields, tags: [...fields.tags] })).toBe(true);
    expect(samePlannedFields({ ...fields, notes: null }, { ...fields, notes: '' })).toBe(true);
    expect(samePlannedFields(fields, { ...fields, amount: '12.99' })).toBe(false);
    expect(samePlannedFields(fields, { ...fields, tags: [] })).toBe(false);
  });

  it('keeps a rule’s own triggers and actions, renaming the old name', () => {
    const fields = fieldsOf(groupPlanned([bill, rule, recurrence])[0]!, '2026-09-28');
    const body = ruleBody(
      { ...fields, name: 'Spotify Family', categoryName: 'Media' },
      rule.attributes as never,
      'Spotify',
      null,
    );
    expect(body.triggers).toEqual([
      expect.objectContaining({ type: 'description_contains', value: 'Spotify Family' }),
      expect.objectContaining({ type: 'amount_less', value: '50' }),
    ]);
    expect(body.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'set_budget', value: 'Fun' }),
        expect.objectContaining({ type: 'set_category', value: 'Media' }),
        expect.objectContaining({ type: 'link_to_bill', value: 'Spotify Family' }),
      ]),
    );
    expect(
      (body.actions as { type: string }[]).filter((a) => a.type === 'set_category'),
    ).toHaveLength(1);
  });

  it('sends either a repetition count or an end date, never both', () => {
    const fields = {
      ...fieldsOf(groupPlanned([bill, rule, recurrence])[0]!, '2026-09-28'),
      sourceId: '1',
      destinationId: '4',
    };
    const once = recurrenceBody({ ...fields, repeats: false }, null, {});
    expect(once).toMatchObject({ nr_of_repetitions: 1 });
    expect(once).not.toHaveProperty('repeat_until');
    const repeating = recurrenceBody({ ...fields, repeats: true }, null, {});
    expect(repeating).toMatchObject({ repeat_until: '2099-12-31' });
    expect(repeating).not.toHaveProperty('nr_of_repetitions');
  });

  it('sends accounts and the category by id, never by name', () => {
    const fields = fieldsOf(groupPlanned([bill, rule, recurrence])[0]!, '2026-09-28');
    const body = recurrenceBody({ ...fields, sourceId: '1', destinationId: '4' }, null, {
      categoryId: '12',
    });
    const [transaction] = body.transactions as Record<string, unknown>[];
    expect(transaction).toMatchObject({ source_id: '1', destination_id: '4', category_id: '12' });
    expect(transaction).not.toHaveProperty('destination_name');
    expect(transaction).not.toHaveProperty('category_name');
    expect(
      (
        recurrenceBody({ ...fields, sourceId: '1', destinationId: '4' }, null, {})
          .transactions as Record<string, unknown>[]
      )[0],
    ).toMatchObject({ category_id: null });
  });

  it('omits tags from recurrence transaction when empty, and includes them when present', () => {
    const fields = fieldsOf(groupPlanned([bill, rule, recurrence])[0]!, '2026-09-28');
    const withTags = recurrenceBody(
      { ...fields, tags: ['sub', 'spotify'], sourceId: '1', destinationId: '4' },
      null,
      {},
    );
    const [txWith] = withTags.transactions as Record<string, unknown>[];
    expect(txWith!.tags).toEqual(['sub', 'spotify']);

    const withoutTags = recurrenceBody(
      { ...fields, tags: [], sourceId: '1', destinationId: '4' },
      null,
      {},
    );
    const [txWithout] = withoutTags.transactions as Record<string, unknown>[];
    expect(txWithout).not.toHaveProperty('tags');

    const emptyStrings = recurrenceBody(
      { ...fields, tags: ['', '   '], sourceId: '1', destinationId: '4' },
      null,
      {},
    );
    const [txEmpty] = emptyStrings.transactions as Record<string, unknown>[];
    expect(txEmpty).not.toHaveProperty('tags');
  });

  it('sends every repetition type in the shape FF3 validates, and reads it back unchanged', () => {
    const base = {
      ...fieldsOf(groupPlanned([bill, rule, recurrence])[0]!, '2026-09-28'),
      sourceId: '1',
      destinationId: '4',
    };
    const cases: Repetition[] = [
      // validateDaily wants the moment empty.
      { type: 'daily', moment: '', skip: 0, weekend: 1 },
      { type: 'weekly', moment: '3', skip: 1, weekend: 3 },
      { type: 'monthly', moment: '28', skip: 2, weekend: 2 },
      { type: 'ndom', moment: '2,1', skip: 0, weekend: 4 },
      { type: 'yearly', moment: '2026-09-28', skip: 1, weekend: 1 },
    ];
    for (const rep of cases) {
      expect(repetitionProblem(rep)).toBeNull();
      const body = recurrenceBody({ ...base, repetitions: [rep] }, null, {});
      const [sent] = body.repetitions as Record<string, unknown>[];
      expect(sent).toEqual({
        type: rep.type,
        moment: rep.moment,
        skip: rep.skip,
        weekend: rep.weekend,
      });
      // FF3's `moment` budget is 10 characters, which `Y-m-d` fills exactly.
      expect(String(sent!.moment).length).toBeLessThanOrEqual(10);
      // Read back out of a recurrence FF3 would answer with: the same repetition.
      const back = fieldsOf(
        groupPlanned([
          bill,
          rule,
          {
            ...recurrence,
            attributes: { ...recurrence.attributes, repetitions: [{ id: '9', ...rep }] },
          } as PlannedObject,
        ])[0]!,
        '2026-09-28',
      );
      expect(back.repetitions).toEqual([{ id: '9', ...rep }]);
    }
  });

  it('refuses a moment the type cannot hold', () => {
    expect(repetitionProblem({ type: 'daily', moment: '5', skip: 0, weekend: 1 })).toBe('moment');
    expect(repetitionProblem({ type: 'weekly', moment: '8', skip: 0, weekend: 1 })).toBe('moment');
    expect(repetitionProblem({ type: 'monthly', moment: '0', skip: 0, weekend: 1 })).toBe('moment');
    expect(repetitionProblem({ type: 'yearly', moment: '28', skip: 0, weekend: 1 })).toBe('moment');
    expect(repetitionProblem({ type: 'monthly', moment: '5', skip: 99, weekend: 1 })).toBe('skip');
  });

  it('keeps every repetition of a multi-repetition recurrence', () => {
    const first = { id: '9', type: 'monthly', moment: '1', skip: 0, weekend: 1 } as const;
    const fifteenth = { id: '10', type: 'monthly', moment: '15', skip: 0, weekend: 1 } as const;
    const both = {
      ...recurrence,
      attributes: { ...recurrence.attributes, repetitions: [first, fifteenth] },
    } as PlannedObject;
    const fields = fieldsOf(groupPlanned([bill, rule, both])[0]!, '2026-09-28');
    expect(fields.repetitions).toHaveLength(2);
    // A non-schedule edit sends no repetitions at all, so neither can be lost.
    const renamed = { ...fields, name: 'Spotify Family', sourceId: '1', destinationId: '4' };
    expect(recurrenceBody(renamed, fields, {})).not.toHaveProperty('repetitions');
    // A schedule edit sends both, and the ids are deliberately left off: FF3 deletes and recreates
    // the rows whenever the counts differ, and replay.ts makes sure they always do.
    const moved = { ...renamed, date: '2026-11-01' };
    const sent = recurrenceBody(moved, fields, {}).repetitions as Record<string, unknown>[];
    expect(sent).toEqual([
      { type: 'monthly', moment: '1', skip: 0, weekend: 1 },
      { type: 'monthly', moment: '15', skip: 0, weekend: 1 },
    ]);
  });

  it('reads the same schedule in either order as unchanged', () => {
    const a = { type: 'monthly', moment: '1', skip: 0, weekend: 1 } as const;
    const b = { type: 'monthly', moment: '15', skip: 0, weekend: 1 } as const;
    const fields = fieldsOf(groupPlanned([bill, rule, recurrence])[0]!, '2026-09-28');
    const one = { ...fields, repetitions: [a, b] };
    expect(scheduleChanged(one, { ...fields, repetitions: [b, a] })).toBe(false);
    expect(scheduleChanged(one, { ...fields, repetitions: [a] })).toBe(true);
    expect(samePlannedFields(one, { ...fields, repetitions: [b, a] })).toBe(true);
  });

  it('derives a lossy bill schedule from the repetitions and never reads it back', () => {
    // FF3 bills take weekly/monthly/quarterly/half-year/yearly only.
    expect(billSchedule([{ type: 'daily', moment: '', skip: 3, weekend: 1 }])).toEqual({
      repeat_freq: 'weekly',
      skip: 0,
    });
    expect(billSchedule([{ type: 'ndom', moment: '2,1', skip: 0, weekend: 1 }])).toEqual({
      repeat_freq: 'monthly',
      skip: 0,
    });
    // Every 3 months stays monthly + skip rather than being relabelled quarterly: that relabelling
    // is what never round-tripped.
    expect(billSchedule([{ type: 'monthly', moment: '5', skip: 2, weekend: 1 }])).toEqual({
      repeat_freq: 'monthly',
      skip: 2,
    });
    // Several repetitions: the most frequent one.
    expect(
      billSchedule([
        { type: 'yearly', moment: '2026-01-01', skip: 0, weekend: 1 },
        { type: 'weekly', moment: '1', skip: 0, weekend: 1 },
      ]),
    ).toEqual({ repeat_freq: 'weekly', skip: 0 });
  });

  it('normalises a save queued by the build that kept five presets', () => {
    const fields = fieldsOf(groupPlanned([bill, rule, recurrence])[0]!, '2026-09-28');
    const legacy = {
      ...fields,
      date: '2026-09-28',
      repetitions: undefined,
      end: undefined,
      skipDays: undefined,
      frequency: 'quarterly',
      every: 1,
    } as unknown as PlannedFields;
    expect(normalizeFields(legacy)).toMatchObject({
      // quarterly was monthly + skip 2 underneath all along.
      repetitions: [{ type: 'monthly', moment: '28', skip: 2, weekend: 1 }],
      end: { kind: 'forever' },
      skipDays: [],
    });
    const yearly = normalizeFields({
      ...legacy,
      frequency: 'yearly',
      every: 2,
    } as unknown as PlannedFields);
    expect(yearly.repetitions).toEqual([
      { type: 'yearly', moment: '2026-09-28', skip: 1, weekend: 1 },
    ]);
    // Already normal: untouched, same object.
    expect(normalizeFields(fields)).toBe(fields);
  });

  it('keeps both markers in the recurrence notes and the user’s note on the bill', () => {
    const fields = {
      ...fieldsOf(groupPlanned([bill, rule, recurrence])[0]!, '2026-09-28'),
      sourceId: '1',
      destinationId: '4',
    };
    const skipping = { ...fields, time: '09:30', skipDays: ['2026-11-05'], notes: 'Mine' };
    expect(recurrenceBody(skipping, fields, {}).notes).toBe(
      'mmyway-time: 09:30 mmyway-skip: 2026-11-05',
    );
    expect(billBody(skipping, fields).notes).toBe('Mine');
    // A marker a newer build wrote survives this build reading and rewriting the notes.
    expect(recurrenceBody(skipping, fields, { existingNotes: 'mmyway-future: 1' }).notes).toContain(
      'mmyway-future: 1',
    );
  });

  it('moves a one-off read back from FF3 without a yearly repetition', () => {
    // As the simple view saves a one-off: a yearly bill that ends the next day, one repetition.
    const oneOffBill: PlannedObject = {
      ...bill,
      attributes: { ...bill.attributes, repeat_freq: 'yearly', end_date: '2026-10-06' },
    };
    const oneOffRecurrence: PlannedObject = {
      ...recurrence,
      attributes: {
        ...recurrence.attributes,
        nr_of_repetitions: 1,
        repetitions: [
          {
            id: '9',
            type: 'monthly',
            moment: '5',
            skip: 0,
            occurrences: ['2026-10-05T00:00:00+02:00'],
          },
        ],
      },
    };
    const before = fieldsOf(groupPlanned([oneOffBill, rule, oneOffRecurrence])[0]!, '2026-09-28');
    expect(before).toMatchObject({
      repeats: false,
      date: '2026-10-05',
      end: { kind: 'times', count: 1 },
    });
    const moved = { ...before, date: '2026-10-12' };
    const body = recurrenceBody({ ...moved, sourceId: '1', destinationId: '4' }, before, {});
    expect(body).toMatchObject({
      first_date: '2026-10-12',
      nr_of_repetitions: 1,
      repetitions: [{ type: 'monthly', moment: '5' }],
    });
    expect(body).not.toHaveProperty('repeat_until');
  });

  it('sends an end date or a count, whichever the user chose', () => {
    const fields = {
      ...fieldsOf(groupPlanned([bill, rule, recurrence])[0]!, '2026-09-28'),
      sourceId: '1',
      destinationId: '4',
    };
    const until = recurrenceBody(
      { ...fields, end: { kind: 'until', date: '2027-06-01' } },
      null,
      {},
    );
    expect(until).toMatchObject({ repeat_until: '2027-06-01' });
    expect(until).not.toHaveProperty('nr_of_repetitions');
    const times = recurrenceBody({ ...fields, end: { kind: 'times', count: 12 } }, null, {});
    expect(times).toMatchObject({ nr_of_repetitions: 12 });
    expect(times).not.toHaveProperty('repeat_until');
  });

  it('shows queued saves and hides queued deletes', () => {
    const fields = fieldsOf(groupPlanned([bill, rule, recurrence])[0]!, '2026-09-28');
    const saved = plannedItems(
      [bill, rule, recurrence],
      [
        {
          kind: 'save_planned',
          sequence: 1,
          payloadJson: JSON.stringify({
            key: 'spotify',
            billId: '1',
            before: null,
            fields: { ...fields, amount: '9.99' },
          }),
        },
      ],
      '2026-09-28',
    );
    expect(saved[0]).toMatchObject({ queued: true, fields: { amount: '9.99' } });
    const deleted = plannedItems(
      [bill, rule, recurrence],
      [
        {
          kind: 'delete_planned',
          sequence: 1,
          payloadJson: JSON.stringify({ key: 'spotify', name: 'Spotify', billId: '1' }),
        },
      ],
      '2026-09-28',
    );
    expect(deleted).toHaveLength(0);
  });

  it('lists only complete trios, unless a queued save is completing one', () => {
    expect(plannedItems([bill, rule, recurrence], [], '2026-09-28')).toHaveLength(1);
    expect(plannedItems([bill, rule], [], '2026-09-28')).toHaveLength(0);
    expect(plannedItems([recurrence], [], '2026-09-28')).toHaveLength(0);
    const fields = fieldsOf(groupPlanned([bill])[0]!, '2026-09-28');
    const saving = plannedItems(
      [bill],
      [
        {
          kind: 'save_planned',
          sequence: 1,
          payloadJson: JSON.stringify({ key: 'spotify', billId: '1', before: null, fields }),
        },
      ],
      '2026-09-28',
    );
    expect(saving).toHaveLength(1);
  });
});
