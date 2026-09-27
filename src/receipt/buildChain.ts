import { createLocalProvider } from './providers/local';
import { createGeminiProvider } from './providers/gemini';
import { getLocalModelBaseUrl, getLocalModelName } from '../settings/appSettings';
import { readGeminiKey } from '../settings/secrets';
import type { OutboxDb } from '../sync/outbox';
import type { ReceiptProvider } from './types';

// Ordered [local, gemini] per brief §3.3B — the local model is free and offline, Gemini is the
// fallback. A provider whose configuration is absent is skipped rather than attempted and failed.
export async function buildChain(db: OutboxDb): Promise<ReceiptProvider[]> {
  const [localBaseUrl, localModelName, geminiKey] = await Promise.all([
    getLocalModelBaseUrl(db),
    getLocalModelName(db),
    readGeminiKey(),
  ]);

  const providers: ReceiptProvider[] = [];
  if (localBaseUrl && localModelName) providers.push(createLocalProvider({ baseUrl: localBaseUrl, model: localModelName }));
  if (geminiKey) providers.push(createGeminiProvider({ apiKey: geminiKey }));
  return providers;
}
