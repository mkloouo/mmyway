import type { ReceiptProvider } from '../types';
import { imageMimeType, normalizeExtraction } from './local';
import { receiptJsonSchema, receiptPrompt } from '../prompt';

// The model's answer is the text of its non-thought parts. Reading parts[0] alone broke on
// models that put a thought (or a thought signature) first.
function answerText(body: any): string {
  const parts: any[] = body?.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((p) => typeof p?.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('');
}

export function createGeminiProvider(config: {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
}): ReceiptProvider {
  const model = config.model ?? 'gemini-3.1-flash-lite';
  return {
    name: 'Gemini',
    model,
    async extract({ imageBase64, hint, categoryNames, currencyCodes = [] }) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 30000);
      const call = (withSchema: boolean) =>
        fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          // The key goes in a header, not the query string, where proxies and logs keep URLs.
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: receiptPrompt(hint) },
                  { inline_data: { mime_type: imageMimeType(imageBase64), data: imageBase64 } },
                ],
              },
            ],
            // Without a schema the model answered in its own shape (`total`, `store`, …) and every
            // field the app reads came back empty — the "0 matched data" receipt.
            generationConfig: withSchema
              ? {
                  responseMimeType: 'application/json',
                  responseJsonSchema: receiptJsonSchema(categoryNames, currencyCodes),
                }
              : { responseMimeType: 'application/json' },
          }),
        });
      try {
        let response = await call(true);
        // A model or API version that rejects the schema answers 400; the prompt alone still
        // names every field, so try once more without it rather than failing the receipt.
        if (response.status === 400) response = await call(false);
        if (!response.ok) throw new Error(`gemini provider HTTP ${response.status}`);
        // A malformed answer must read as "answered badly", not as a TypeError — the chain
        // treats a TypeError as unreachable and would retry the same image forever.
        let parsed: unknown;
        try {
          parsed = JSON.parse(answerText(await response.json()));
        } catch {
          throw new Error('gemini provider returned an unreadable response');
        }
        return normalizeExtraction(parsed);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
