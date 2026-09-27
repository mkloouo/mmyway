import { createTestDb } from '../db/client';
import { matchAlias, upsertAlias } from './aliases';

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
});
