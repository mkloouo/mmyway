import { buildManualEntryInput, type CaptureFormState } from './buildManualEntryInput';

const accounts = [{ id: 'acc-cash', name: 'Cash' }, { id: 'acc-pko', name: 'PKO' }];
const base: CaptureFormState = {
  type: 'withdrawal', amount: '22.41', currencyCode: 'PLN', date: new Date('2026-09-27T14:02:00.000Z'),
  description: '', merchantRawInput: 'Żabka', forceNewPayee: false,
  sourceId: 'acc-cash', destinationId: null, categoryName: 'Groceries', budgetId: null,
  notes: '', sharedWith: '', foreignAmount: '', foreignCurrencyCode: null,
};

describe('buildManualEntryInput', () => {
  it('withdrawal: payee is the destination, source is the asset account', () => {
    const input = buildManualEntryInput(base, accounts);
    expect(input).toMatchObject({
      type: 'withdrawal', amount: '22.41', currencyCode: 'PLN',
      merchantRawInput: 'Żabka', sourceId: 'acc-cash', sourceName: 'Cash',
      destinationId: undefined, destinationName: undefined, categoryName: 'Groceries',
    });
  });

  it('drops a bare trailing separator the keypad can leave behind', () => {
    expect(buildManualEntryInput({ ...base, amount: '22.' }, accounts).amount).toBe('22');
  });

  it('deposit: payee is the source, destination is the asset account', () => {
    const state: CaptureFormState = { ...base, type: 'deposit', merchantRawInput: 'Employer', sourceId: null, destinationId: 'acc-pko' };
    const input = buildManualEntryInput(state, accounts);
    expect(input).toMatchObject({
      type: 'deposit', merchantRawInput: 'Employer',
      sourceId: undefined, sourceName: undefined,
      destinationId: 'acc-pko', destinationName: 'PKO',
    });
  });

  it('transfer: both ends are asset accounts, no payee sent even if typed', () => {
    const state: CaptureFormState = { ...base, type: 'transfer', merchantRawInput: 'should be ignored', sourceId: 'acc-cash', destinationId: 'acc-pko' };
    const input = buildManualEntryInput(state, accounts);
    expect(input.merchantRawInput).toBeUndefined();
    expect(input.forceNewPayee).toBeUndefined();
    expect(input).toMatchObject({ sourceId: 'acc-cash', sourceName: 'Cash', destinationId: 'acc-pko', destinationName: 'PKO' });
  });

  it('falls back to the payee, then the type, as the description', () => {
    expect(buildManualEntryInput({ ...base, description: '' }, accounts).description).toBe('Żabka');
    expect(buildManualEntryInput({ ...base, description: '', merchantRawInput: '' }, accounts).description).toBe('withdrawal');
    expect(buildManualEntryInput({ ...base, description: 'Weekly shop' }, accounts).description).toBe('Weekly shop');
  });

  it('FX: books the account-currency figure as the amount and the typed one as foreign', () => {
    // 123.12 PLN typed, paid from a EUR account that moved 1000 EUR.
    const input = buildManualEntryInput({ ...base, amount: '123.12', currencyCode: 'PLN', foreignAmount: '1000', foreignCurrencyCode: 'EUR' }, accounts);
    expect(input).toMatchObject({ amount: '1000', currencyCode: 'EUR', foreignAmount: '123.12', foreignCurrencyCode: 'PLN' });
  });

  it('sends no foreign side without a foreign amount', () => {
    const input = buildManualEntryInput({ ...base, foreignAmount: '', foreignCurrencyCode: 'EUR' }, accounts);
    expect(input).toMatchObject({ amount: '22.41', currencyCode: 'PLN' });
    expect(input.foreignAmount).toBeUndefined();
    expect(input.foreignCurrencyCode).toBeUndefined();
  });

  it('serialises the date as ISO', () => {
    expect(buildManualEntryInput(base, accounts).date).toBe('2026-09-27T14:02:00.000Z');
  });
});
