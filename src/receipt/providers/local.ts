import { parseDecimalInput } from '../../api/ff3/decimal';
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
                  { type: 'image_url', image_url: { url: `data:${imageMimeType(imageBase64)};base64,${imageBase64}` } },
                ],
              },
            ],
            response_format: { type: 'json_schema', json_schema: { name: 'receipt', schema: RECEIPT_JSON_SCHEMA, strict: true } },
          }),
        });
        if (!response.ok) throw new Error(`local provider HTTP ${response.status}`);
        // A malformed answer must read as "answered badly", not as a TypeError — the chain
        // treats a TypeError as unreachable and would retry the same image forever.
        let parsed: unknown;
        try {
          const body = await response.json();
          parsed = JSON.parse(body.choices[0].message.content);
        } catch {
          throw new Error('local provider returned an unreadable response');
        }
        return normalizeExtraction(parsed);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function amountOf(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    // A model that ignores the schema and answers 12.5 — keep its digits, never re-round them.
    const parsed = parseDecimalInput(String(value));
    return parsed.ok ? parsed.value : null;
  }
  if (typeof value !== 'string') return null;
  const parsed = parseDecimalInput(value);
  return parsed.ok ? parsed.value : null;
}

function matching(value: unknown, pattern: RegExp): string | null {
  return typeof value === 'string' && pattern.test(value) ? value : null;
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

// Everything a provider returns is untrusted: the local model's json_schema is advisory for some
// servers, and Gemini is only asked for JSON. Each field is checked for the shape the rest of the
// app assumes (a decimal-string amount, YYYY-MM-DD, HH:mm) and dropped to null otherwise — a
// numeric amount used to reach draftReadiness and crash it on `.trim()`.
function normalizeExtraction(raw: any): ReceiptExtraction {
  const value = raw && typeof raw === 'object' ? raw : {};
  const items = Array.isArray(value.items) ? value.items : [];
  return {
    amount: amountOf(value.amount),
    currency: matching(typeof value.currency === 'string' ? value.currency.trim().toUpperCase() : null, /^[A-Z]{3}$/),
    merchant: textOf(value.merchant),
    date: matching(value.date, /^\d{4}-\d{2}-\d{2}$/),
    time: matching(value.time, /^\d{2}:\d{2}$/),
    category: textOf(value.category),
    items: items.flatMap((item: any) => {
      if (!item || typeof item !== 'object' || typeof item.title !== 'string') return [];
      const price = amountOf(item.price);
      const count = typeof item.count === 'number' && Number.isFinite(item.count) ? item.count : 1;
      return price === null ? [] : [{ title: item.title, count, price }];
    }),
    confidence: typeof value.confidence === 'number' ? Math.min(1, Math.max(0, value.confidence)) : 0,
    paymentMethod: value.payment_method === 'cash' || value.payment_method === 'card' ? value.payment_method : 'unknown',
    cardNetwork: textOf(value.card_network),
  };
}

/** Receipts arrive as JPEG from the camera but PNG/WebP from a shared screenshot. */
export function imageMimeType(base64: string): string {
  if (base64.startsWith('iVBOR')) return 'image/png';
  if (base64.startsWith('UklGR')) return 'image/webp';
  return 'image/jpeg';
}

export { normalizeExtraction };
