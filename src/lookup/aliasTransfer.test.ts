import { createTestDb } from '../db/testDb';
import { rememberPayeeAlias, matchPayeeAlias } from './aliases';
import { exportAliasesJson, importAliasesJson } from './aliasTransfer';

describe('aliasTransfer (N-to-1 JSON import/export)', () => {
  it('exports aliases grouped by canonical payee', async () => {
    const db = createTestDb();
    await rememberPayeeAlias(db as any, 'Jeronimo Martins', 'Biedronka');
    await rememberPayeeAlias(db as any, 'Biedra', 'Biedronka');

    const json = await exportAliasesJson(db as any);
    const parsed = JSON.parse(json);
    expect(parsed).toEqual({
      Biedronka: expect.arrayContaining(['Jeronimo Martins', 'Biedra']),
    });
  });

  it('imports aliases from JSON dictionary', async () => {
    const db = createTestDb();
    const payload = JSON.stringify({
      Żabka: ['Zabka Polska', 'ZABKA Z11'],
      IKEA: ['IKEA Retail'],
    });

    const result = await importAliasesJson(db as any, payload);
    expect(result.importedCount).toBe(3);

    const m1 = await matchPayeeAlias(db as any, 'zabka polska');
    expect(m1).toEqual({ matched: true, payeeName: 'Żabka', alias: 'Zabka Polska' });

    const m2 = await matchPayeeAlias(db as any, 'ikea retail');
    expect(m2).toEqual({ matched: true, payeeName: 'IKEA', alias: 'IKEA Retail' });
  });

  it('rejects invalid JSON string', async () => {
    const db = createTestDb();
    await expect(importAliasesJson(db as any, 'not-json')).rejects.toThrow('Invalid JSON');
  });
});
