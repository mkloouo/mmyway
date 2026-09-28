import { createTestDb } from '../db/testDb';
import { upsertAlias, matchAlias } from './aliases';
import { exportAliasesJson, importAliasesJson } from './aliasTransfer';

describe('exportAliasesJson / importAliasesJson', () => {
  it('round-trips payee aliases through export then import into a fresh db', async () => {
    const source = createTestDb();
    await upsertAlias(source, { kind: 'payee', rawInput: 'Żabka', targetId: 'acc-1', targetName: 'Żabka' });
    await upsertAlias(source, { kind: 'payee', rawInput: 'IKEA RETAIL SP. Z O.O.', targetId: null, targetName: 'IKEA' });

    const json = await exportAliasesJson(source);

    const destination = createTestDb();
    const result = await importAliasesJson(destination, json);

    expect(result).toMatchObject({ imported: 2, skipped: 0 });
    expect(result.collisions).toHaveLength(0);
    expect(await matchAlias(destination, 'payee', 'zabka')).toMatchObject({ matched: true, alias: { targetName: 'Żabka' } });
    expect(await matchAlias(destination, 'payee', 'ikea retail sp z o o')).toMatchObject({ matched: true, alias: { targetName: 'IKEA' } });
  });

  it('leaves account, budget and currency aliases out of the export and skips them on import', async () => {
    const source = createTestDb();
    await upsertAlias(source, { kind: 'payee', rawInput: 'zab', targetId: null, targetName: 'Żabka' });
    await upsertAlias(source, { kind: 'account', rawInput: 'checking', targetId: 'acc-2', targetName: 'Checking' });
    expect(JSON.parse(await exportAliasesJson(source))).toHaveLength(1);

    const destination = createTestDb();
    const result = await importAliasesJson(destination, JSON.stringify([
      { kind: 'payee', rawInput: 'zab', targetId: null, targetName: 'Żabka' },
      { kind: 'budget', rawInput: 'groceries', targetId: null, targetName: 'Groceries' },
      { kind: 'currency', rawInput: 'zl', targetId: null, targetName: 'PLN' },
    ]));

    expect(result).toMatchObject({ imported: 1, skipped: 2 });
    expect(await matchAlias(destination, 'budget', 'groceries')).toMatchObject({ matched: false });
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
