import type { ReceiptProvider } from '../types';
import { imageMimeType, normalizeExtraction } from './local';

export function createGeminiProvider(config: { apiKey: string; model?: string; timeoutMs?: number }): ReceiptProvider {
  const model = config.model ?? 'gemini-3.1-flash-lite';
  return {
    name: 'gemini',
    async extract({ imageBase64, hint, categoryNames }) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 15000);
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: 'POST',
            // The key goes in a header, not the query string, where proxies and logs keep URLs.
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
            signal: controller.signal,
            body: JSON.stringify({
              contents: [{
                parts: [
                  { text: `Extract structured data from this receipt photo. Known categories: ${categoryNames.join(', ')}. ${hint ?? ''}` },
                  { inline_data: { mime_type: imageMimeType(imageBase64), data: imageBase64 } },
                ],
              }],
              generationConfig: { responseMimeType: 'application/json' },
            }),
          },
        );
        if (!response.ok) throw new Error(`gemini provider HTTP ${response.status}`);
        // A malformed answer must read as "answered badly", not as a TypeError — the chain
        // treats a TypeError as unreachable and would retry the same image forever.
        let parsed: unknown;
        try {
          const body = await response.json();
          parsed = JSON.parse(body.candidates[0].content.parts[0].text);
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
