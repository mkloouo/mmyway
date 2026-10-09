import { createTestDb } from '../db/testDb';
import {
  matchPayeeAlias,
  rememberPayeeAlias,
  removePayeeAlias,
  removePayeeGroup,
  renamePayeeGroup,
  getPayeesWithAliases,
  resolvePayeeAlias,
} from './aliases';
import type { Draft } from '../inbox/draft';

describe('N-to-1 Payee Aliases', () => {
  it('allows multiple aliases to point to one canonical payee', async () => {
    const db = createTestDb();

    await rememberPayeeAlias(db as any, 'Jeronimo Martins Polska S.A.', 'Biedronka');
    await rememberPayeeAlias(db as any, 'Biedronka Sklep 4512', 'Biedronka');
    await rememberPayeeAlias(db as any, 'BIEDR. WARSZ.', 'Biedronka');

    const m1 = await matchPayeeAlias(db as any, 'jeronimo martins polska s.a.');
    const m2 = await matchPayeeAlias(db as any, 'BIEDRONKA SKLEP 4512');
    const m3 = await matchPayeeAlias(db as any, 'biedr. warsz.');

    expect(m1).toEqual({
      matched: true,
      payeeName: 'Biedronka',
      alias: 'Jeronimo Martins Polska S.A.',
    });
    expect(m2).toEqual({ matched: true, payeeName: 'Biedronka', alias: 'Biedronka Sklep 4512' });
    expect(m3).toEqual({ matched: true, payeeName: 'Biedronka', alias: 'BIEDR. WARSZ.' });
  });

  it('rejects learning when alias equals canonical payee', async () => {
    const db = createTestDb();
    const learned = await rememberPayeeAlias(db as any, 'Biedronka', 'Biedronka');
    expect(learned).toBe(false);

    const learnedFolded = await rememberPayeeAlias(db as any, 'biedronka', 'Biedronka');
    expect(learnedFolded).toBe(false);
  });

  it('removes a single alias while keeping other aliases for that payee', async () => {
    const db = createTestDb();

    await rememberPayeeAlias(db as any, 'Zabka Polska sp z o.o.', 'Żabka');
    await rememberPayeeAlias(db as any, 'ZABKA Z412', 'Żabka');

    await removePayeeAlias(db as any, 'zabka z412');

    const m1 = await matchPayeeAlias(db as any, 'Zabka Polska sp z o.o.');
    const m2 = await matchPayeeAlias(db as any, 'ZABKA Z412');

    expect(m1.matched).toBe(true);
    expect(m2.matched).toBe(false);
  });

  it('removes entire payee group and all its aliases', async () => {
    const db = createTestDb();

    await rememberPayeeAlias(db as any, 'Uber BV', 'Uber');
    await rememberPayeeAlias(db as any, 'Uber Eats Amsterdam', 'Uber');

    await removePayeeGroup(db as any, 'Uber');

    const m1 = await matchPayeeAlias(db as any, 'Uber BV');
    const m2 = await matchPayeeAlias(db as any, 'Uber Eats Amsterdam');

    expect(m1.matched).toBe(false);
    expect(m2.matched).toBe(false);
  });

  it('renames canonical payee across all its aliases', async () => {
    const db = createTestDb();

    await rememberPayeeAlias(db as any, 'Aldi Nord', 'Aldi');
    await rememberPayeeAlias(db as any, 'Aldi Sud', 'Aldi');

    await renamePayeeGroup(db as any, 'Aldi', 'Aldi Stores');

    const m1 = await matchPayeeAlias(db as any, 'Aldi Nord');
    expect(m1).toEqual({ matched: true, payeeName: 'Aldi Stores', alias: 'Aldi Nord' });
  });

  it('groups aliases under their canonical payee in getPayeesWithAliases', async () => {
    const db = createTestDb();

    await rememberPayeeAlias(db as any, 'Lidl sp. z o.o.', 'Lidl');
    await rememberPayeeAlias(db as any, 'LIDL SKLEP', 'Lidl');
    await rememberPayeeAlias(db as any, 'Rossmann SDP', 'Rossmann');

    const groups = await getPayeesWithAliases(db as any);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.payeeName).toBe('Lidl');
    expect(groups[0]?.aliases).toHaveLength(2);
    expect(groups[1]?.payeeName).toBe('Rossmann');
    expect(groups[1]?.aliases).toHaveLength(1);
  });

  it('resolves payee alias on a receipt draft and records payeeReadAs', async () => {
    const db = createTestDb();

    await rememberPayeeAlias(db as any, 'Jeronimo Martins Polska S.A.', 'Biedronka');

    const draft: Draft = {
      type: 'withdrawal',
      amount: '45.20',
      currencyCode: 'PLN',
      date: new Date().toISOString(),
      description: 'Receipt',
      destinationName: 'Jeronimo Martins Polska S.A.',
      isNewPayee: true,
    };

    const resolved = await resolvePayeeAlias(db as any, draft);
    expect(resolved.destinationName).toBe('Biedronka');
    expect(resolved.isNewPayee).toBe(false);
    expect(resolved.payeeReadAs).toBe('Jeronimo Martins Polska S.A.');
  });
});
