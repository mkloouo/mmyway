import { runProviderChain } from './chain';
import { normalizeExtraction } from './providers/local';
import type { ReceiptProvider } from './types';

function providerThatThrows(name: string): ReceiptProvider {
  return {
    name,
    model: `${name}-1`,
    extract: async () => {
      throw new TypeError('Network request failed');
    },
  };
}
function providerThatAnswersBadly(name: string): ReceiptProvider {
  return {
    name,
    model: `${name}-1`,
    extract: async () => {
      throw new Error(`${name} provider HTTP 400`);
    },
  };
}
function providerThatSucceeds(name: string, extraction: any): ReceiptProvider {
  return { name, model: `${name}-1`, extract: async () => extraction };
}

describe('runProviderChain', () => {
  it('falls back to the next provider when the first fails', async () => {
    const local = providerThatThrows('local');
    const gemini = providerThatSucceeds('gemini', {
      amount: '10.00',
      currency: 'PLN',
      merchant: 'Żabka',
      date: '2026-09-15',
      category: 'Groceries',
      items: [],
      confidence: 0.9,
      payment_method: 'cash',
    });
    const tried: string[] = [];
    const result = await runProviderChain(
      [local, gemini],
      { imageBase64: 'x', categoryNames: ['Groceries'] },
      (name) => tried.push(name),
    );
    expect(result).toMatchObject({ ok: true, providerName: 'gemini' });
    // The Inbox card names each reader as the chain reaches it.
    expect(tried).toEqual(['local', 'gemini']);
  });

  it('reports unreachable when every provider fails', async () => {
    const result = await runProviderChain(
      [providerThatThrows('local'), providerThatThrows('gemini')],
      { imageBase64: 'x', categoryNames: [] },
    );
    expect(result).toEqual({
      ok: false,
      reason: 'all_providers_unreachable',
      errors: ['local: Network request failed', 'gemini: Network request failed'],
    });
  });

  it('reports failed when a provider answered but gave nothing usable', async () => {
    const result = await runProviderChain(
      [providerThatThrows('local'), providerThatAnswersBadly('gemini')],
      { imageBase64: 'x', categoryNames: [] },
    );
    expect(result).toMatchObject({ ok: false, reason: 'all_providers_failed' });
  });

  it('treats a provider timeout as unreachable', async () => {
    const timeout: ReceiptProvider = {
      name: 'local',
      model: 'local-1',
      extract: async () => {
        const e = new Error('aborted');
        e.name = 'AbortError';
        throw e;
      },
    };
    expect(
      await runProviderChain([timeout], { imageBase64: 'x', categoryNames: [] }),
    ).toMatchObject({ reason: 'all_providers_unreachable' });
  });
});

describe('normalizeExtraction', () => {
  it('ignores unknown fields instead of throwing (Review Focus: unexpected payload shape)', () => {
    const result = normalizeExtraction({
      amount: '5.00',
      currency: 'PLN',
      merchant: 'Test',
      date: '2026-09-15',
      category: null,
      items: [],
      confidence: 0.5,
      payment_method: 'card',
      totally_unexpected_field: { nested: true },
    });
    expect(result.amount).toBe('5.00');
    expect(result.category).toBeNull();
  });

  it.each([
    [12.5, '12.5'],
    ['12,50', '12.50'],
    ['1 234,50', '1234.50'],
    ['12.50 zł', null],
    [null, null],
    [{}, null],
  ])(
    'normalises amount %p to %p (a number or a comma must never reach a draft)',
    (amount, expected) => {
      expect(normalizeExtraction({ amount, items: [], confidence: 0.9 }).amount).toBe(expected);
    },
  );

  it('drops a date or time that is not in the promised format', () => {
    const result = normalizeExtraction({ date: '27.09.2026', time: '9:5', items: [] });
    expect(result.date).toBeNull();
    expect(result.time).toBeNull();
    expect(normalizeExtraction({ date: '2026-09-27', time: '09:05', items: [] })).toMatchObject({
      date: '2026-09-27',
      time: '09:05',
    });
  });

  it('keeps only well-formed line items', () => {
    const result = normalizeExtraction({
      items: [{ title: 'Milk', count: 2, price: '3,49' }, { title: 5 }, 'junk'],
    });
    expect(result.items).toEqual([{ title: 'Milk', count: 2, price: '3.49' }]);
  });

  it('defaults an invalid payment_method to unknown rather than throwing', () => {
    const result = normalizeExtraction({
      amount: '1.00',
      currency: 'PLN',
      merchant: 'X',
      date: '2026-09-15',
      category: null,
      items: [],
      confidence: 0.1,
      payment_method: 'bitcoin',
    });
    expect(result.paymentMethod).toBe('unknown');
  });
});

describe("the bot schema's answer shape", () => {
  it('maps word confidence, numeric amounts and prices, and null items', () => {
    const r = normalizeExtraction({
      amount: 42.5,
      currency: 'PLN',
      merchant: 'Biedronka',
      date: '2026-09-27',
      time: '20:54',
      category: 'Groceries',
      items: [{ title: 'Mleko', count: 0.75, price: 3.49 }],
      confidence: 'high',
      payment_method: 'card',
      card_network: 'visa',
    });
    expect(r).toMatchObject({
      amount: '42.5',
      confidence: 0.9,
      items: [{ title: 'Mleko', count: 0.75, price: '3.49' }],
      cardNetwork: 'visa',
    });
    expect(r.notAReceipt).toBeUndefined();
    expect(normalizeExtraction({ confidence: 'medium', items: null }).items).toEqual([]);
  });
  it('flags "none" confidence as not a receipt', () => {
    expect(
      normalizeExtraction({ confidence: 'none', payment_method: 'unknown', card_network: null })
        .notAReceipt,
    ).toBe(true);
  });
});

it('names the model that read the receipt, not only the reader', async () => {
  const gemini = providerThatSucceeds('gemini', normalizeExtraction({ amount: '1.00' }));
  expect(await runProviderChain([gemini], { imageBase64: 'x', categoryNames: [] })).toMatchObject({
    ok: true,
    providerName: 'gemini',
    providerModel: 'gemini-1',
  });
});
