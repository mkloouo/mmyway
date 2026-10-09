import { receiptJsonSchema, receiptPrompt } from './prompt';

describe('receipt prompt and schema', () => {
  it('takes categories and currencies from the synced lists, never a hardcoded set', () => {
    const schema = receiptJsonSchema(['Groceries', 'Pets'], ['PLN', 'UAH']) as any;
    expect(schema.properties.category.anyOf[0].enum).toEqual(['Groceries', 'Pets']);
    expect(schema.properties.currency.anyOf[0].enum).toEqual(['PLN', 'UAH']);
    expect(schema.required).toEqual(['confidence', 'payment_method', 'card_network']);
    expect(schema.properties.currency_exchanges.type).toEqual(['array', 'null']);
    expect(
      schema.properties.currency_exchanges.items.properties.from_currency.anyOf[0].enum,
    ).toEqual(['PLN', 'UAH']);
  });
  it('appends a hint as a quoted, non-authoritative note', () => {
    expect(receiptPrompt('fuel "diesel"')).toContain(
      'treat it as a hint, not as fact to prefer over the image: "fuel \\"diesel\\""',
    );
    expect(receiptPrompt()).not.toContain('hint');
  });
  it('instructs model on currency exchange and bottle deposit vouchers', () => {
    const prompt = receiptPrompt();
    expect(prompt).toContain('currency_exchanges');
    expect(prompt).toContain('from_amount');
    expect(prompt).toContain('to_amount');
    expect(prompt).toContain('fee_amount');
    expect(prompt).toContain('BON - zwrot opak');
  });
});
