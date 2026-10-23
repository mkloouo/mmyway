import { createTestDb } from '../db/testDb';
import {
  getEnvelopeOrder,
  parseEnvelopeOrder,
  setEnvelopeOrder,
  sortEnvelopesByOrder,
} from './envelopeOrder';
import type { Envelope } from '../bucket/envelopes';

const mockEnvelope = (budgetId: string, name: string): Envelope => ({
  budgetId,
  name,
  limitId: null,
  currencyCode: 'PLN',
  assigned: '100.00',
  spent: '0',
  available: '100.00',
  overspent: false,
});

describe('envelopeOrder', () => {
  it('parses valid JSON into an order record', () => {
    expect(parseEnvelopeOrder('{"b1": 0, "b2": 1}')).toEqual({ b1: 0, b2: 1 });
  });

  it('falls back to empty record on null or invalid JSON', () => {
    expect(parseEnvelopeOrder(null)).toEqual({});
    expect(parseEnvelopeOrder('invalid json')).toEqual({});
    expect(parseEnvelopeOrder('{"b1": "not-a-number"}')).toEqual({});
  });

  it('reads and writes envelope order in DB', async () => {
    const db = createTestDb();
    expect(await getEnvelopeOrder(db as never)).toEqual({});

    await setEnvelopeOrder(db as never, { b2: 0, b1: 1 });
    expect(await getEnvelopeOrder(db as never)).toEqual({ b2: 0, b1: 1 });
  });

  it('sorts envelopes by explicit order, falling back to name', () => {
    const list = [
      mockEnvelope('b1', 'Groceries'),
      mockEnvelope('b2', 'Dining Out'),
      mockEnvelope('b3', 'Fun'),
    ];

    const sorted = sortEnvelopesByOrder(list, { b3: 0, b1: 1 });
    expect(sorted.map((e) => e.name)).toEqual(['Fun', 'Groceries', 'Dining Out']);
  });
});
