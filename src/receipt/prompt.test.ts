import { receiptJsonSchema, receiptPrompt } from './prompt';

describe('receipt prompt and schema', () => {
  it('takes categories and currencies from the synced lists, never a hardcoded set', () => {
    const schema = receiptJsonSchema(['Groceries', 'Pets'], ['PLN', 'UAH']) as any;
    expect(schema.properties.category.anyOf[0].enum).toEqual(['Groceries', 'Pets']);
    expect(schema.properties.currency.anyOf[0].enum).toEqual(['PLN', 'UAH']);
    expect(schema.required).toEqual(['confidence', 'payment_method', 'card_network']);
  });
  it('appends a hint as a quoted, non-authoritative note', () => {
    expect(receiptPrompt('fuel "diesel"')).toContain(
      'treat it as a hint, not as fact to prefer over the image: "fuel \\"diesel\\""',
    );
    expect(receiptPrompt()).not.toContain('hint');
  });
});
