import { parseDecimalInput } from '../../api/ff3/decimal';
import type { ReceiptExtraction, ReceiptProvider } from '../types';
import { receiptJsonSchema, receiptPrompt } from '../prompt';

/** Whether an OpenAI-compatible server answers at this address (Settings' address test, sync's probe). */
export async function probeLocalModel(address: string): Promise<boolean> {
  try {
    const response = await fetch(`${address.replace(/\/+$/, '')}/v1/models`, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}

export function createLocalProvider(config: { baseUrl: string; model: string; timeoutMs?: number }): ReceiptProvider {
  return {
    name: 'local',
    async extract({ imageBase64, hint, categoryNames, currencyCodes = [] }) {
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
              { role: 'system', content: receiptPrompt(hint) },
              {
                role: 'user',
                content: [{ type: 'image_url', image_url: { url: `data:${imageMimeType(imageBase64)};base64,${imageBase64}` } }],
              },
            ],
            response_format: { type: 'json_schema', json_schema: { name: 'receipt', schema: receiptJsonSchema(categoryNames, currencyCodes), strict: false } },
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

// The schema asks for a word; older models (and the tests) answer a number.
const CONFIDENCE_WORDS: Record<string, number> = { high: 0.9, medium: 0.6, low: 0.3, none: 0 };
function confidenceOf(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.min(1, Math.max(0, value));
  if (typeof value === 'string' && value.toLowerCase() in CONFIDENCE_WORDS) return CONFIDENCE_WORDS[value.toLowerCase()]!;
  return 0;
}

/** confidence "none": the model says the picture isn't a receipt at all. */
export function isNotAReceipt(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && (raw as { confidence?: unknown }).confidence === 'none';
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
    confidence: confidenceOf(value.confidence),
    paymentMethod: value.payment_method === 'cash' || value.payment_method === 'card' ? value.payment_method : 'unknown',
    cardNetwork: textOf(value.card_network),
    notAReceipt: isNotAReceipt(value) || undefined,
  };
}

/** Receipts arrive as JPEG from the camera but PNG/WebP from a shared screenshot. */
export function imageMimeType(base64: string): string {
  if (base64.startsWith('iVBOR')) return 'image/png';
  if (base64.startsWith('UklGR')) return 'image/webp';
  return 'image/jpeg';
}

export { normalizeExtraction };
