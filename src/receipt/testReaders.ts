import { createLocalProvider } from './providers/local';
import { createGeminiProvider } from './providers/gemini';
import type { OutboxDb } from '../sync/outbox';
import {
  getLocalModelBaseUrls,
  getLocalModelActiveUrl,
  getLocalModelName,
} from '../settings/appSettings';
import { readGeminiKey } from '../settings/secrets';

export const SAMPLE_RECEIPT_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

export type ReaderTestResult =
  | { status: 'ok'; seconds: string }
  | { status: 'error'; messageKey: 'testKeyRejected' | 'testUnreachable' | 'error'; raw?: string }
  | { status: 'not_configured' };

export interface ReadersTestSummary {
  local: ReaderTestResult;
  gemini: ReaderTestResult;
}

function classifyError(err: unknown): ReaderTestResult {
  const msg = err instanceof Error ? err.message : String(err);
  if (/40[013]|key|api_key/i.test(msg)) {
    return { status: 'error', messageKey: 'testKeyRejected', raw: msg };
  }
  if (/network|econnrefused|failed to fetch|abort|timeout|unreachable/i.test(msg)) {
    return { status: 'error', messageKey: 'testUnreachable', raw: msg };
  }
  return { status: 'error', messageKey: 'error', raw: msg };
}

export async function testReaders(db: OutboxDb): Promise<ReadersTestSummary> {
  const [baseUrls, activeUrl, modelName, geminiKey] = await Promise.all([
    getLocalModelBaseUrls(db),
    getLocalModelActiveUrl(db),
    getLocalModelName(db),
    readGeminiKey(),
  ]);

  const targetUrl = (activeUrl && baseUrls.includes(activeUrl) ? activeUrl : baseUrls[0]) ?? null;

  let local: ReaderTestResult = { status: 'not_configured' };
  if (targetUrl && modelName) {
    const provider = createLocalProvider({ baseUrl: targetUrl, model: modelName, timeoutMs: 5000 });
    const start = Date.now();
    try {
      await provider.extract({ imageBase64: SAMPLE_RECEIPT_BASE64, categoryNames: [] });
      const seconds = ((Date.now() - start) / 1000).toFixed(1);
      local = { status: 'ok', seconds };
    } catch (err) {
      local = classifyError(err);
    }
  }

  let gemini: ReaderTestResult = { status: 'not_configured' };
  if (geminiKey) {
    const provider = createGeminiProvider({ apiKey: geminiKey, timeoutMs: 5000 });
    const start = Date.now();
    try {
      await provider.extract({ imageBase64: SAMPLE_RECEIPT_BASE64, categoryNames: [] });
      const seconds = ((Date.now() - start) / 1000).toFixed(1);
      gemini = { status: 'ok', seconds };
    } catch (err) {
      gemini = classifyError(err);
    }
  }

  return { local, gemini };
}

export function shortLabel(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function formatReaderSub(
  r: ReaderTestResult | undefined,
  tr: (key: string, opts?: Record<string, unknown>) => string,
  successKey: string,
): string {
  if (!r || r.status === 'not_configured') return tr('receiptSettings.testNotConfigured');
  if (r.status === 'ok') return tr(successKey, { seconds: r.seconds });
  return tr(`receiptSettings.${r.messageKey}`, { defaultValue: r.raw });
}
