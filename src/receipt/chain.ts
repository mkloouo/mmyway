import type { ReceiptProvider, ReceiptChainResult } from './types';

export async function runProviderChain(
  providers: ReceiptProvider[],
  input: { imageBase64: string; hint?: string; categoryNames: string[] },
): Promise<ReceiptChainResult> {
  for (const provider of providers) {
    try {
      const extraction = await provider.extract(input);
      return { ok: true, providerName: provider.name, extraction };
    } catch {
      continue; // try the next provider in the chain
    }
  }
  return { ok: false, reason: 'all_providers_unreachable' };
}
