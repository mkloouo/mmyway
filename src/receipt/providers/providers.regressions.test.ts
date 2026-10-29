import { createLocalProvider, normalizeExtraction } from './local';
import { createGeminiProvider } from './gemini';
import { runProviderChain } from '../chain';

const raw = {
  amount: 42.5,
  currency: 'PLN',
  merchant: 'Shop',
  confidence: 'high',
  payment_method: 'card',
  items: null,
  currency_exchanges: null,
};
const input = { imageBase64: 'aGk=', categoryNames: [], currencyCodes: ['PLN'] };
const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  jest.useRealTimers();
});

it.each([
  { items: null },
  { items: 'invalid' },
  { currency_exchanges: null },
  { currency_exchanges: {} },
  { currencyExchanges: null },
])('keeps valid receipt fields when an optional list is %j', (optional) => {
  expect(normalizeExtraction({ ...raw, ...optional })).toMatchObject({
    amount: '42.5',
    currency: 'PLN',
    merchant: 'Shop',
    confidence: 0.9,
    paymentMethod: 'card',
    items: [],
  });
});

const providers = [
  [
    'local',
    () => createLocalProvider({ baseUrl: 'https://model.example', model: 'test', timeoutMs: 100 }),
  ],
  ['Gemini', () => createGeminiProvider({ apiKey: 'test-only', timeoutMs: 100 })],
] as const;

it.each(providers)(
  '%s accepts the nullable fields its requested schema allows',
  async (name, make) => {
    const text = JSON.stringify(raw);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () =>
        name === 'local'
          ? { choices: [{ message: { content: text } }] }
          : {
              candidates: [
                { content: { parts: [{ thought: true, text: 'reasoning' }, { text }] } },
              ],
            },
    });
    expect(await make().extract(input)).toMatchObject({
      amount: '42.5',
      currency: 'PLN',
      merchant: 'Shop',
    });
  },
);

it.each(providers)('%s keeps a response-body timeout retryable', async (_name, make) => {
  jest.useFakeTimers();
  global.fetch = jest.fn(async (_url, init) => ({
    ok: true,
    status: 200,
    json: () =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          // Hermes may reject an aborted body with a plain Error.
          reject(error);
        });
      }),
  })) as unknown as typeof fetch;
  const result = runProviderChain([make()], input);
  await jest.advanceTimersByTimeAsync(101);
  expect(await result).toMatchObject({ ok: false, reason: 'all_providers_unreachable' });
});
