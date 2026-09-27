import type { ReceiptProvider } from '../types';
import { normalizeExtraction } from './local';

export function createGeminiProvider(config: { apiKey: string; model?: string; timeoutMs?: number }): ReceiptProvider {
  const model = config.model ?? 'gemini-3.1-flash-lite';
  return {
    name: 'gemini',
    async extract({ imageBase64, hint, categoryNames }) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 15000);
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              contents: [{
                parts: [
                  { text: `Extract structured data from this receipt photo. Known categories: ${categoryNames.join(', ')}. ${hint ?? ''}` },
                  { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
                ],
              }],
              generationConfig: { responseMimeType: 'application/json' },
            }),
          },
        );
        if (!response.ok) throw new Error(`gemini provider HTTP ${response.status}`);
        const body = await response.json();
        const parsed = JSON.parse(body.candidates[0].content.parts[0].text);
        return normalizeExtraction(parsed);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
