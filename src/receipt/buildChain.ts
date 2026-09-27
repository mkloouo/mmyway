import { createLocalProvider } from './providers/local';
import { createGeminiProvider } from './providers/gemini';
import { getLocalModelBaseUrls, getLocalModelActiveUrl, getLocalModelName } from '../settings/appSettings';
import { readGeminiKey } from '../settings/secrets';
import type { OutboxDb } from '../sync/outbox';
import type { ReceiptProvider } from './types';

// Ordered [local, gemini] per brief §3.3B — the local model is free and offline, Gemini is the
// fallback. A provider whose configuration is absent is skipped rather than attempted and failed.
//
// The local model may have several addresses (design §6.6); buildChain picks the one that last
// answered a sync's reachability probe (src/sync/reachability.ts writes it) rather than probing
// again here — a receipt capture shouldn't pay for a second round trip on every parse. If that
// address later turns out to be unreachable, runProviderChain already falls through to Gemini.
export async function buildChain(db: OutboxDb): Promise<ReceiptProvider[]> {
  const [baseUrls, remembered, localModelName, geminiKey] = await Promise.all([
    getLocalModelBaseUrls(db),
    getLocalModelActiveUrl(db),
    getLocalModelName(db),
    readGeminiKey(),
  ]);

  const providers: ReceiptProvider[] = [];
  const address = (remembered && baseUrls.includes(remembered) ? remembered : baseUrls[0]) ?? null;
  if (address && localModelName) providers.push(createLocalProvider({ baseUrl: address, model: localModelName }));
  if (geminiKey) providers.push(createGeminiProvider({ apiKey: geminiKey }));
  return providers;
}
