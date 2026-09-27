import { runProviderChain } from './chain';
import { normalizeExtraction } from './providers/local';
import type { ReceiptProvider } from './types';

function providerThatThrows(name: string): ReceiptProvider {
  return { name, extract: async () => { throw new Error('unreachable'); } };
}
function providerThatSucceeds(name: string, extraction: any): ReceiptProvider {
  return { name, extract: async () => extraction };
}

describe('runProviderChain', () => {
  it('falls back to the next provider when the first fails', async () => {
    const local = providerThatThrows('local');
    const gemini = providerThatSucceeds('gemini', { amount: '10.00', currency: 'PLN', merchant: 'Żabka', date: '2026-09-15', category: 'Groceries', items: [], confidence: 0.9, payment_method: 'cash' });
    const result = await runProviderChain([local, gemini], { imageBase64: 'x', categoryNames: ['Groceries'] });
    expect(result).toMatchObject({ ok: true, providerName: 'gemini' });
  });

  it('reports unreachable when every provider fails', async () => {
    const result = await runProviderChain([providerThatThrows('local'), providerThatThrows('gemini')], { imageBase64: 'x', categoryNames: [] });
    expect(result).toEqual({ ok: false, reason: 'all_providers_unreachable' });
  });
});

describe('normalizeExtraction', () => {
  it('ignores unknown fields instead of throwing (Review Focus: unexpected payload shape)', () => {
    const result = normalizeExtraction({
      amount: '5.00', currency: 'PLN', merchant: 'Test', date: '2026-09-15', category: null,
      items: [], confidence: 0.5, payment_method: 'card',
      totally_unexpected_field: { nested: true },
    });
    expect(result.amount).toBe('5.00');
    expect(result.category).toBeNull();
  });

  it('defaults an invalid payment_method to unknown rather than throwing', () => {
    const result = normalizeExtraction({ amount: '1.00', currency: 'PLN', merchant: 'X', date: '2026-09-15', category: null, items: [], confidence: 0.1, payment_method: 'bitcoin' });
    expect(result.paymentMethod).toBe('unknown');
  });
});
