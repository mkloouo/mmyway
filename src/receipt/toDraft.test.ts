import { receiptToDraft, type ReceiptDraftReference } from './toDraft';
import { normalizeExtraction } from './providers/local';

const reference: ReceiptDraftReference = {
  categoryNames: ['Groceries', 'Food'],
  currencyCodes: ['PLN', 'EUR'],
  cashAccountId: 'acc-cash',
  cardAccountId: 'acc-card',
};

describe('receiptToDraft', () => {
  it('maps a confident extraction to a withdrawal with the payment method preset', () => {
    const extraction = normalizeExtraction({
      amount: '42.50', currency: 'PLN', merchant: 'Żabka', date: '2026-09-15', category: 'Groceries',
      items: [{ title: 'Milk', count: 2, price: '4.00' }], confidence: 0.9, payment_method: 'cash',
    });
    const draft = receiptToDraft(extraction, reference);
    expect(draft).toMatchObject({
      type: 'withdrawal', amount: '42.50', currencyCode: 'PLN', categoryName: 'Groceries',
      destinationName: 'Żabka', isNewPayee: true, sourceId: 'acc-cash',
    });
    expect(draft.notes).toBe('2x Milk (4.00)');
  });

  it('ignores an unknown extra field and leaves the currency blank when it is not synced (not a throw)', () => {
    const extraction = normalizeExtraction({
      amount: '10.00', currency: 'USD', merchant: 'Test', date: '2026-09-15', category: null,
      items: [], confidence: 0.9, payment_method: 'card',
      totally_unexpected_field: { nested: true },
    });
    expect(() => receiptToDraft(extraction, reference)).not.toThrow();
    const draft = receiptToDraft(extraction, reference);
    expect(draft.currencyCode).toBe(''); // USD is not in reference.currencyCodes
    expect(draft.sourceId).toBe('acc-card');
  });

  it('leaves the currency blank when confidence is too low even if the currency is known', () => {
    const extraction = normalizeExtraction({
      amount: '10.00', currency: 'PLN', merchant: 'Test', date: '2026-09-15', category: null,
      items: [], confidence: 0.1, payment_method: 'unknown',
    });
    const draft = receiptToDraft(extraction, reference);
    expect(draft.currencyCode).toBe('');
    expect(draft.sourceId).toBeUndefined();
  });

  it('leaves category empty when the extracted category is not a synced reference category', () => {
    const extraction = normalizeExtraction({
      amount: '10.00', currency: 'PLN', merchant: 'Test', date: '2026-09-15', category: 'Made Up Category',
      items: [], confidence: 0.9, payment_method: 'cash',
    });
    const draft = receiptToDraft(extraction, reference);
    expect(draft.categoryName).toBeUndefined();
  });
});
