import type { ReceiptExtraction, ReceiptProvider } from '../types';

const RECEIPT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    amount: { type: ['string', 'null'] },
    currency: { type: ['string', 'null'] },
    merchant: { type: ['string', 'null'] },
    date: { type: ['string', 'null'] },
    time: { type: ['string', 'null'] },
    category: { type: ['string', 'null'] },
    items: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, count: { type: 'number' }, price: { type: 'string' } }, required: ['title', 'count', 'price'] } },
    confidence: { type: 'number' },
    payment_method: { type: 'string', enum: ['cash', 'card', 'unknown'] },
    card_network: { type: ['string', 'null'] },
  },
  required: ['amount', 'currency', 'merchant', 'date', 'category', 'items', 'confidence', 'payment_method'],
} as const;

export function createLocalProvider(config: { baseUrl: string; model: string; timeoutMs?: number }): ReceiptProvider {
  return {
    name: 'local',
    async extract({ imageBase64, hint, categoryNames }) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 20000);
      try {
        const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            model: config.model,
            messages: [
              {
                role: 'system',
                content: `Extract structured data from this receipt photo. Known categories: ${categoryNames.join(', ')}. If the merchant doesn't clearly match a known category, leave category null rather than guessing.`,
              },
              {
                role: 'user',
                content: [
                  { type: 'text', text: hint ?? '' },
                  { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
                ],
              },
            ],
            response_format: { type: 'json_schema', json_schema: { name: 'receipt', schema: RECEIPT_JSON_SCHEMA, strict: true } },
          }),
        });
        if (!response.ok) throw new Error(`local provider HTTP ${response.status}`);
        const body = await response.json();
        const parsed = JSON.parse(body.choices[0].message.content);
        return normalizeExtraction(parsed);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function normalizeExtraction(raw: any): ReceiptExtraction {
  return {
    amount: raw.amount ?? null,
    currency: raw.currency ?? null,
    merchant: raw.merchant ?? null,
    date: raw.date ?? null,
    time: raw.time ?? null,
    category: raw.category ?? null,
    items: Array.isArray(raw.items) ? raw.items : [],
    confidence: typeof raw.confidence === 'number' ? raw.confidence : 0,
    paymentMethod: raw.payment_method === 'cash' || raw.payment_method === 'card' ? raw.payment_method : 'unknown',
    cardNetwork: raw.card_network ?? null,
  };
}

export { normalizeExtraction };
