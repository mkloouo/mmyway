import { newSplit, patchSplit, toPayloadSplits, type EditableSplit } from './editSplits';

const split = (over: Partial<EditableSplit> = {}): EditableSplit => ({
  journalId: 'j1',
  amount: '10.00',
  description: 'one',
  sourceId: '1',
  sourceName: null,
  destinationId: '8',
  destinationName: null,
  categoryName: 'Groceries',
  budgetId: null,
  notes: null,
  tags: [],
  internalReference: null,
  ...over,
});

const group = { type: 'withdrawal' as const, date: '2026-09-15', currencyCode: 'PLN' };

describe('toPayloadSplits', () => {
  // Probed against FF3 version-6.7.6: PUT /v1/transactions with `tags: []` answers 200 and the
  // reread group comes back with `tags: []`. An empty array is how an edit clears tags, so unlike
  // a recurrence (which rejects `[]` with "must be at least 1 characters") it must be sent.
  it('sends an empty tag array, which is how an edit clears tags', () => {
    const [sent] = toPayloadSplits([split({ tags: [] })], group);
    expect(sent!.tags).toEqual([]);
  });

  it('drops blank tags rather than sending them', () => {
    const [sent] = toPayloadSplits([split({ tags: ['  ', 'lidl', ''] })], group);
    expect(sent!.tags).toEqual(['lidl']);
  });

  it('clears a category and a note with null, never an empty string', () => {
    const [sent] = toPayloadSplits([split({ categoryName: null, notes: '' })], group);
    expect(sent!.category_name).toBeNull();
    expect(sent!.notes).toBeNull();
  });

  it('sends an end by id when it has one, by name when it does not', () => {
    const [sent] = toPayloadSplits(
      [split({ destinationId: null, destinationName: 'New Shop' })],
      group,
    );
    expect(sent!.destination_id).toBeUndefined();
    expect(sent!.destination_name).toBe('New Shop');
    expect(sent!.source_id).toBe('1');
    expect(sent!.source_name).toBeUndefined();
  });

  // Removing the one split that carried the app's `mmyway:<id>` must not cut the transaction loose
  // from the entry that made it, so the reference is copied onto every split that is left.
  it("keeps the group's reference when the split that carried it is gone", () => {
    const kept = split({ journalId: 'j2', internalReference: null });
    const carrier = split({ journalId: 'j1', internalReference: 'mmyway:abc' });

    const both = toPayloadSplits([carrier, kept], group);
    expect(both.map((s) => (s as { internal_reference?: string }).internal_reference)).toEqual([
      'mmyway:abc',
      'mmyway:abc',
    ]);

    // The carrier removed: the survivor still names the entry.
    const [survivor] = toPayloadSplits([kept], group);
    expect((survivor as { internal_reference?: string }).internal_reference).toBeUndefined();
  });

  it('sends a kept split by journal id and a new one without', () => {
    const sent = toPayloadSplits(
      [split({ journalId: 'j1' }), newSplit(split(), '5.00', 'two')],
      group,
    );
    expect(sent[0]!.transaction_journal_id).toBe('j1');
    expect(sent[1]).not.toHaveProperty('transaction_journal_id');
  });
});

describe('patchSplit', () => {
  // FF3 rejects a withdrawal whose splits leave from different accounts, so the shared end of a
  // group travels to every split while the per-split end stays put.
  it("moves a withdrawal's source to every split but its payee to one", () => {
    const splits = [split({ journalId: 'j1' }), split({ journalId: 'j2' })];

    const sourceMoved = patchSplit(splits, 0, { sourceId: '2', sourceName: null }, 'withdrawal');
    expect(sourceMoved.map((s) => s.sourceId)).toEqual(['2', '2']);

    const payeeMoved = patchSplit(
      splits,
      0,
      { destinationId: '9', destinationName: null },
      'withdrawal',
    );
    expect(payeeMoved.map((s) => s.destinationId)).toEqual(['9', '8']);
  });

  it("moves a deposit's destination to every split but its payer to one", () => {
    const splits = [split({ journalId: 'j1' }), split({ journalId: 'j2' })];

    const ownMoved = patchSplit(
      splits,
      0,
      { destinationId: '9', destinationName: null },
      'deposit',
    );
    expect(ownMoved.map((s) => s.destinationId)).toEqual(['9', '9']);

    const payerMoved = patchSplit(splits, 0, { sourceId: '2', sourceName: null }, 'deposit');
    expect(payerMoved.map((s) => s.sourceId)).toEqual(['2', '1']);
  });

  it('leaves every other field to the split being edited', () => {
    const splits = [split({ journalId: 'j1' }), split({ journalId: 'j2' })];
    const patched = patchSplit(splits, 1, { amount: '99.00', categoryName: 'Fuel' }, 'withdrawal');
    expect(patched.map((s) => s.amount)).toEqual(['10.00', '99.00']);
    expect(patched.map((s) => s.categoryName)).toEqual(['Groceries', 'Fuel']);
  });
});
