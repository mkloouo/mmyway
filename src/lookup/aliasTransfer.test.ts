import { createTestDb } from '../db/testDb';
import { upsertAlias, matchAlias } from './aliases';
import { exportAliasesJson, importAliasesJson } from './aliasTransfer';

describe('exportAliasesJson / importAliasesJson', () => {
  it('round-trips every alias through export then import into a fresh db', async () => {
    const source = createTestDb();
    await upsertAlias(source, { kind: 'payee', rawInput: 'Żabka', targetId: 'acc-1', targetName: 'Żabka' });
    await upsertAlias(source, { kind: 'account', rawInput: 'checking', targetId: 'acc-2', targetName: 'Checking' });
    await upsertAlias(source, { kind: 'budget', rawInput: 'groceries', targetId: null, targetName: 'Groceries' });
    await upsertAlias(source, { kind: 'currency', rawInput: 'zl', targetId: null, targetName: 'PLN' });

    const json = await exportAliasesJson(source);

    const destination = createTestDb();
    const result = await importAliasesJson(destination, json);

    expect(result.imported).toBe(4);
    expect(result.collisions).toHaveLength(0);
    expect(await matchAlias(destination, 'payee', 'zabka')).toMatchObject({ matched: true, alias: { targetName: 'Żabka' } });
    expect(await matchAlias(destination, 'account', 'checking')).toMatchObject({ matched: true, alias: { targetId: 'acc-2' } });
  });

  it('reports a collision on a normalized key instead of overwriting the existing alias', async () => {
    const db = createTestDb();
    await upsertAlias(db, { kind: 'payee', rawInput: 'Żabka', targetId: 'acc-1', targetName: 'Żabka (original)' });
    const json = JSON.stringify([{ kind: 'payee', rawInput: 'zabka', targetId: 'acc-99', targetName: 'Żabka (incoming)' }]);

    const result = await importAliasesJson(db, json);

    expect(result.imported).toBe(0);
    expect(result.collisions).toEqual([
      { kind: 'payee', rawInput: 'zabka', existingTargetName: 'Żabka (original)', incomingTargetName: 'Żabka (incoming)' },
    ]);
    // untouched — the existing alias, not the incoming one, is what a lookup still returns
    const match = await matchAlias(db, 'payee', 'Żabka');
    expect(match).toMatchObject({ matched: true, alias: { targetName: 'Żabka (original)' } });
  });
});
