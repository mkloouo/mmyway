// Several addresses per server (design §6.6, brief §9 Q4): the tailnet name, a LAN IP, a public
// hostname — the app tries the remembered address first, then the rest in order, first success
// wins. Storage here; FF3 and the local model both resolve through the same `resolveAddress`.
import * as SecureStore from 'expo-secure-store';

const HOSTS_KEY = 'ff3_hosts';
const LEGACY_HOST_KEY = 'ff3_host'; // pre-multi-address installs: one bare string, not JSON

export async function readHosts(): Promise<string[]> {
  const raw = await SecureStore.getItemAsync(HOSTS_KEY);
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) return parsed;
    } catch {
      // fall through to the legacy key
    }
  }
  const legacy = await SecureStore.getItemAsync(LEGACY_HOST_KEY);
  return legacy ? [legacy] : [];
}

export async function writeHosts(list: string[]): Promise<void> {
  await SecureStore.setItemAsync(HOSTS_KEY, JSON.stringify(list));
}

export interface AddressProbeResult {
  address: string;
  ok: boolean;
}

export interface ResolveResult {
  winner: string | null;
  results: AddressProbeResult[];
}

/**
 * Pure resolution, injected probe. Remembered address first, then the rest in order, first
 * success wins. A probe failure on one address is not an error — running out of addresses is.
 */
export async function resolveAddress(
  addresses: string[],
  remembered: string | null,
  probe: (address: string) => Promise<boolean>,
): Promise<ResolveResult> {
  const ordered = remembered && addresses.includes(remembered)
    ? [remembered, ...addresses.filter((a) => a !== remembered)]
    : addresses;

  const results: AddressProbeResult[] = [];
  for (const address of ordered) {
    const ok = await probe(address);
    results.push({ address, ok });
    if (ok) return { winner: address, results };
  }
  return { winner: null, results };
}

const DEFAULT_TIMEOUT_MS = 4000;

/**
 * A per-address timeout so one unreachable tailnet address can't hang a sync on mobile data.
 * Clears its own timer once the probe settles either way — an uncleared `setTimeout` is a
 * dangling handle that keeps a test runner (and, in principle, the JS engine) alive for no reason.
 */
export function withTimeout(probe: (address: string) => Promise<boolean>, timeoutMs = DEFAULT_TIMEOUT_MS): (address: string) => Promise<boolean> {
  return (address) => new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    probe(address)
      .catch(() => false)
      .then((ok) => { clearTimeout(timer); resolve(ok); });
  });
}
