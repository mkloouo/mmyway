import {
  receiptToDraft,
  receiptDate,
  receiptLocalDate,
  buildReceiptDraftReference,
  type ReceiptDraftReference,
} from './toDraft';
import { normalizeExtraction } from './providers/local';
import { createTestDb } from '../db/testDb';
import { setCashAccountId, setDefaultSourceAccountId } from '../settings/appSettings';

// When the photo was taken: 10:00 in Warsaw (jest.config.js pins TZ=Europe/Warsaw).
const takenAt = new Date('2026-09-15T08:00:00Z');

const reference: ReceiptDraftReference = {
  categoryNames: ['Groceries', 'Food'],
  currencyCodes: ['PLN', 'EUR'],
  cashAccountId: 'acc-cash',
  cardAccountId: 'acc-card',
};

describe('receiptToDraft', () => {
  it('maps a confident extraction to a withdrawal with the payment method preset', () => {
    const extraction = normalizeExtraction({
      amount: '42.50',
      currency: 'PLN',
      merchant: 'Żabka',
      date: '2026-09-15',
      category: 'Groceries',
      items: [{ title: 'Milk', count: 2, price: '4.00' }],
      confidence: 0.9,
      payment_method: 'cash',
    });
    const draft = receiptToDraft(extraction, reference, takenAt);
    expect(draft).toMatchObject({
      type: 'withdrawal',
      amount: '42.50',
      currencyCode: 'PLN',
      categoryName: 'Groceries',
      destinationName: 'Żabka',
      isNewPayee: true,
      sourceId: 'acc-cash',
    });
    expect(draft.notes).toBe('2x Milk (4.00)');
  });

  it('ignores an unknown extra field and leaves the currency blank when it is not synced (not a throw)', () => {
    const extraction = normalizeExtraction({
      amount: '10.00',
      currency: 'USD',
      merchant: 'Test',
      date: '2026-09-15',
      category: null,
      items: [],
      confidence: 0.9,
      payment_method: 'card',
      totally_unexpected_field: { nested: true },
    });
    expect(() => receiptToDraft(extraction, reference, takenAt)).not.toThrow();
    const draft = receiptToDraft(extraction, reference, takenAt);
    expect(draft.currencyCode).toBe(''); // USD is not in reference.currencyCodes
    expect(draft.sourceId).toBe('acc-card');
  });

  it('leaves the currency blank when confidence is too low even if the currency is known', () => {
    const extraction = normalizeExtraction({
      amount: '10.00',
      currency: 'PLN',
      merchant: 'Test',
      date: '2026-09-15',
      category: null,
      items: [],
      confidence: 0.1,
      payment_method: 'unknown',
    });
    const draft = receiptToDraft(extraction, reference, takenAt);
    expect(draft.currencyCode).toBe('');
    expect(draft.sourceId).toBeUndefined();
  });

  it('leaves category empty when the extracted category is not a synced reference category', () => {
    const extraction = normalizeExtraction({
      amount: '10.00',
      currency: 'PLN',
      merchant: 'Test',
      date: '2026-09-15',
      category: 'Made Up Category',
      items: [],
      confidence: 0.9,
      payment_method: 'cash',
    });
    const draft = receiptToDraft(extraction, reference, takenAt);
    expect(draft.categoryName).toBeUndefined();
  });

  it('flags the fields it still populated despite low confidence', () => {
    const extraction = normalizeExtraction({
      amount: '42.50',
      currency: 'PLN',
      merchant: 'Żabka',
      date: '2026-09-15',
      category: null,
      items: [],
      confidence: 0.2,
      payment_method: 'unknown',
    });
    const draft = receiptToDraft(extraction, reference, takenAt);
    expect(draft.lowConfidenceFields).toEqual(['amount', 'payee', 'date']);
  });

  it('leaves lowConfidenceFields unset for a confident extraction', () => {
    const extraction = normalizeExtraction({
      amount: '42.50',
      currency: 'PLN',
      merchant: 'Żabka',
      date: '2026-09-15',
      category: 'Groceries',
      items: [],
      confidence: 0.9,
      payment_method: 'cash',
    });
    const draft = receiptToDraft(extraction, reference, takenAt);
    expect(draft.lowConfidenceFields).toBeUndefined();
  });

  it('falls back to localized Receipt description when merchant is missing', () => {
    const extraction = normalizeExtraction({
      amount: '42.50',
      currency: 'PLN',
      merchant: null,
      date: '2026-09-15',
      category: 'Groceries',
      items: [],
      confidence: 0.9,
      payment_method: 'cash',
    });
    const draft = receiptToDraft(extraction, reference, takenAt);
    expect(draft.description).toBe('Receipt');
  });
});

describe('buildReceiptDraftReference', () => {
  it('a cash receipt uses the configured cash account, not a name match', async () => {
    const db = createTestDb();
    await setCashAccountId(db as any, 'acc-cash-drawer');

    const reference = await buildReceiptDraftReference(db as any);
    expect(reference.cashAccountId).toBe('acc-cash-drawer');

    const extraction = normalizeExtraction({
      amount: '10.00',
      currency: 'PLN',
      merchant: 'Test',
      date: '2026-09-15',
      category: null,
      items: [],
      confidence: 0.9,
      payment_method: 'cash',
    });
    expect(receiptToDraft(extraction, reference, takenAt).sourceId).toBe('acc-cash-drawer');
  });

  it('falls back to leaving the cash source blank, never a guess, when nothing is configured', async () => {
    const db = createTestDb();
    const reference = await buildReceiptDraftReference(db as any);
    expect(reference.cashAccountId).toBeUndefined();

    const extraction = normalizeExtraction({
      amount: '10.00',
      currency: 'PLN',
      merchant: 'Test',
      date: '2026-09-15',
      category: null,
      items: [],
      confidence: 0.9,
      payment_method: 'cash',
    });
    expect(receiptToDraft(extraction, reference, takenAt).sourceId).toBeUndefined();
  });

  it('a card receipt still uses the default source account', async () => {
    const db = createTestDb();
    await setDefaultSourceAccountId(db as any, 'acc-card-default');
    const reference = await buildReceiptDraftReference(db as any);
    expect(reference.cardAccountId).toBe('acc-card-default');
  });
});

describe('receiptLocalDate', () => {
  it('reads a receipt time as local wall-clock time, so a late-evening receipt keeps its day', () => {
    // jest.config.js pins TZ=Europe/Warsaw (UTC+2 in September).
    const d = receiptLocalDate('2026-09-26', '23:30');
    expect(d.getDate()).toBe(26);
    expect(d.toISOString()).toBe('2026-09-26T21:30:00.000Z');
  });
  it('uses noon when the receipt has no time, so no offset can move the day', () => {
    expect(receiptLocalDate('2026-09-26', null).getDate()).toBe(26);
  });
});

describe('receiptDate', () => {
  it('uses the printed date and time when the receipt has both', () => {
    expect(receiptDate({ date: '2026-09-14', time: '19:05' }, takenAt).toISOString()).toBe(
      '2026-09-14T17:05:00.000Z',
    );
  });

  it('dates a receipt with nothing printed by when the photo was taken, not when it was read', () => {
    expect(receiptDate({ date: null, time: null }, takenAt)).toBe(takenAt);
    const extraction = normalizeExtraction({
      amount: '10.00',
      currency: 'PLN',
      merchant: 'Test',
      date: null,
      category: null,
      items: [],
      confidence: 0.9,
      payment_method: 'card',
    });
    expect(receiptToDraft(extraction, reference, takenAt).date).toBe(takenAt.toISOString());
  });

  it("takes the photo's time for a printed date without one, when the photo is from that day", () => {
    expect(receiptDate({ date: '2026-09-15', time: null }, takenAt)).toBe(takenAt);
  });

  it('keeps noon for a printed date without a time when the photo is from another day', () => {
    const d = receiptDate({ date: '2026-09-10', time: null }, takenAt);
    expect(d.getDate()).toBe(10);
    expect(d.getHours()).toBe(12);
  });
});
