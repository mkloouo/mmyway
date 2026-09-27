import { createTestDb } from '../db/testDb';
import { matchAlias, upsertAlias } from './aliases';
import { createManualEntry } from '../inbox/createManualEntry';

describe('matchAlias', () => {
  it('matches an exact alias', async () => {
    const db = createTestDb();
    await upsertAlias(db, { kind: 'payee', rawInput: 'Budget', targetId: null, targetName: 'Budget Car Rental' });
    const result = await matchAlias(db, 'payee', 'budget');
    expect(result).toMatchObject({ matched: true, alias: { targetName: 'Budget Car Rental' } });
  });

  it('does NOT fuzzy-match "Budget AVIS" onto the "Budget" alias — flags it as a new payee', async () => {
    const db = createTestDb();
    await upsertAlias(db, { kind: 'payee', rawInput: 'Budget', targetId: null, targetName: 'Budget Car Rental' });
    const result = await matchAlias(db, 'payee', 'Budget AVIS');
    expect(result.matched).toBe(false);
  });

  it('an alias saved with a targetId round-trips through matchAlias and createManualEntry sets destinationId, not destination_name (brief §3.4)', async () => {
    const db = createTestDb();
    await upsertAlias(db, { kind: 'payee', rawInput: 'zabka', targetId: 'exp-zabka-42', targetName: 'Żabka' });

    const match = await matchAlias(db, 'payee', 'zabka');
    expect(match).toMatchObject({ matched: true, alias: { targetId: 'exp-zabka-42', targetName: 'Żabka' } });

    const { draft } = await createManualEntry(db, {
      type: 'withdrawal', amount: '15.90', currencyCode: 'PLN', date: new Date().toISOString(),
      description: 'snacks', merchantRawInput: 'zabka', sourceId: 'acc-cash',
    });
    expect(draft.destinationId).toBe('exp-zabka-42');
  });
});
