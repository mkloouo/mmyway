import { createTestDb } from '../db/testDb';
import {
  matchAlias,
  upsertAlias,
  resolvePayeeAlias,
  withPayeeAlias,
  rememberPayeeAlias,
} from './aliases';
import { draftToTransactionPayload, type Draft } from '../inbox/draft';
import { createManualEntry } from '../inbox/createManualEntry';

describe('matchAlias', () => {
  it('matches an exact alias', async () => {
    const db = createTestDb();
    await upsertAlias(db, {
      kind: 'payee',
      rawInput: 'Budget',
      targetId: null,
      targetName: 'Budget Car Rental',
    });
    const result = await matchAlias(db, 'payee', 'budget');
    expect(result).toMatchObject({ matched: true, alias: { targetName: 'Budget Car Rental' } });
  });

  it('does NOT fuzzy-match "Budget AVIS" onto the "Budget" alias — flags it as a new payee', async () => {
    const db = createTestDb();
    await upsertAlias(db, {
      kind: 'payee',
      rawInput: 'Budget',
      targetId: null,
      targetName: 'Budget Car Rental',
    });
    const result = await matchAlias(db, 'payee', 'Budget AVIS');
    expect(result.matched).toBe(false);
  });

  it('an alias saved with a targetId round-trips through matchAlias and createManualEntry sets destinationId, not destination_name (brief §3.4)', async () => {
    const db = createTestDb();
    await upsertAlias(db, {
      kind: 'payee',
      rawInput: 'zabka',
      targetId: 'exp-zabka-42',
      targetName: 'Żabka',
    });

    const match = await matchAlias(db, 'payee', 'zabka');
    expect(match).toMatchObject({
      matched: true,
      alias: { targetId: 'exp-zabka-42', targetName: 'Żabka' },
    });

    const { draft } = await createManualEntry(db, {
      type: 'withdrawal',
      amount: '15.90',
      currencyCode: 'PLN',
      date: new Date().toISOString(),
      description: 'snacks',
      merchantRawInput: 'zabka',
      sourceId: 'acc-cash',
    });
    expect(draft.destinationId).toBe('exp-zabka-42');
  });
});

describe('payee aliases on drafts', () => {
  const receipt: Draft = {
    type: 'withdrawal',
    amount: '12.50',
    currencyCode: 'PLN',
    date: '2026-09-27T10:00:00Z',
    description: 'ZABKA POLSKA SP Z O O',
    destinationName: 'ZABKA POLSKA SP Z O O',
    isNewPayee: true,
    sourceId: 'acc-1',
  };

  it("points a receipt's printed merchant at the alias target and keeps what it read", async () => {
    const db = createTestDb();
    await upsertAlias(db, {
      kind: 'payee',
      rawInput: 'ZABKA POLSKA SP Z O O',
      targetId: 'exp-7',
      targetName: 'Żabka',
    });

    const draft = await resolvePayeeAlias(db, receipt);

    expect(draft).toMatchObject({
      destinationName: 'Żabka',
      destinationId: 'exp-7',
      isNewPayee: false,
      payeeReadAs: 'ZABKA POLSKA SP Z O O',
    });
    expect(draftToTransactionPayload('c', draft).splits[0]).toMatchObject({
      destination_id: 'exp-7',
      destination_name: undefined,
    });
  });

  it('leaves a draft whose payee is already a known one alone', async () => {
    const db = createTestDb();
    await upsertAlias(db, {
      kind: 'payee',
      rawInput: 'Żabka',
      targetId: null,
      targetName: 'Something else',
    });
    const known = { ...receipt, destinationName: 'Żabka', isNewPayee: false };
    expect(await resolvePayeeAlias(db, known)).toBe(known);
  });

  it("sends a deposit's payer by name, never an expense-account id", () => {
    const deposit: Draft = {
      ...receipt,
      type: 'deposit',
      destinationName: undefined,
      sourceName: 'ACME SP Z O O',
      destinationId: 'acc-1',
      sourceId: undefined,
    };
    const draft = withPayeeAlias(deposit, { targetId: 'exp-7', targetName: 'Acme' });
    expect(draft).toMatchObject({
      sourceName: 'Acme',
      sourceId: undefined,
      isNewPayee: false,
      payeeReadAs: 'ACME SP Z O O',
    });
    expect(draftToTransactionPayload('c', draft).splits[0]).toMatchObject({
      source_name: 'Acme',
      source_id: undefined,
    });
  });

  it('an alias stored by name still books the payee by name', () => {
    const draft = withPayeeAlias(receipt, { targetId: null, targetName: 'Żabka' });
    expect(draftToTransactionPayload('c', draft).splits[0]).toMatchObject({
      destination_name: 'Żabka',
      destination_id: undefined,
    });
  });

  it('learns a correction, and nothing from a blank or a respelling', async () => {
    const db = createTestDb();
    expect(await rememberPayeeAlias(db, 'ZABKA POLSKA SP Z O O', 'Żabka')).toBe(true);
    expect(await matchAlias(db, 'payee', 'zabka polska sp. z o.o.')).toMatchObject({
      matched: true,
      alias: { targetName: 'Żabka', targetId: null },
    });
    expect(await rememberPayeeAlias(db, '  ', 'Żabka')).toBe(false);
    expect(await rememberPayeeAlias(db, 'ZABKA', 'Żabka')).toBe(false);
  });
});
