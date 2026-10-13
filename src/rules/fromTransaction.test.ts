import { ruleParamsFrom } from './fromTransaction';

type Row = Parameters<typeof ruleParamsFrom>[0];
const row = (fields: Partial<Row>) =>
  ({
    type: 'withdrawal',
    description: 'Groceries',
    sourceName: 'Checking',
    destinationName: 'Biedronka',
    categoryName: 'Food',
    budgetName: null,
    ...fields,
  }) as Row;

describe('ruleParamsFrom', () => {
  it('matches the payee of a withdrawal and keeps its category and budget', () => {
    expect(ruleParamsFrom(row({ budgetName: 'Home' }))).toEqual({
      match: 'Biedronka',
      category: 'Food',
      budget: 'Home',
    });
  });

  it('matches the payer of a deposit', () => {
    expect(ruleParamsFrom(row({ type: 'deposit', sourceName: 'Employer' })).match).toBe('Employer');
  });

  it('falls back to the title for a transfer, and to empty strings for missing fields', () => {
    expect(ruleParamsFrom(row({ type: 'transfer', categoryName: null }))).toEqual({
      match: 'Groceries',
      category: '',
      budget: '',
    });
  });
});
