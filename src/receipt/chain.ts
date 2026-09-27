import type { ReceiptProvider, ReceiptChainResult } from './types';

// fetch rejects with a TypeError when the request never got an answer, and with an AbortError
// when a provider's own timeout fired. Anything else means the provider answered.
export function isUnreachable(err: unknown): boolean {
  return err instanceof TypeError || (err instanceof Error && err.name === 'AbortError');
}

export async function runProviderChain(
  providers: ReceiptProvider[],
  input: { imageBase64: string; hint?: string; categoryNames: string[]; currencyCodes?: string[] },
): Promise<ReceiptChainResult> {
  const errors: string[] = [];
  let anyAnswered = false;
  for (const provider of providers) {
    try {
      const extraction = await provider.extract(input);
      return { ok: true, providerName: provider.name, extraction };
    } catch (err) {
      if (!isUnreachable(err)) anyAnswered = true;
      errors.push(`${provider.name}: ${err instanceof Error ? err.message : String(err)}`);
      // try the next provider in the chain
    }
  }
  return { ok: false, reason: anyAnswered ? 'all_providers_failed' : 'all_providers_unreachable', errors };
}
