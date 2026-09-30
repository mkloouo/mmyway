import type { ReceiptProvider, ReceiptChainResult } from './types';
import { errorMessage } from '../utils/errorMessage';

// fetch rejects with a TypeError when the request never got an answer, and with an AbortError
// when a provider's own timeout fired. Anything else means the provider answered.
function isUnreachable(err: unknown): boolean {
  return err instanceof TypeError || (err instanceof Error && err.name === 'AbortError');
}

export async function runProviderChain(
  providers: ReceiptProvider[],
  input: { imageBase64: string; hint?: string; categoryNames: string[]; currencyCodes?: string[] },
  /** Told each reader's name as the chain tries it (the Inbox card shows which one is reading). */
  onAttempt?: (providerName: string) => void,
): Promise<ReceiptChainResult> {
  const errors: string[] = [];
  let anyAnswered = false;
  for (const provider of providers) {
    onAttempt?.(provider.name);
    try {
      const extraction = await provider.extract(input);
      return { ok: true, providerName: provider.name, extraction };
    } catch (err) {
      if (!isUnreachable(err)) anyAnswered = true;
      errors.push(`${provider.name}: ${errorMessage(err)}`);
      // try the next provider in the chain
    }
  }
  return {
    ok: false,
    reason: anyAnswered ? 'all_providers_failed' : 'all_providers_unreachable',
    errors,
  };
}
