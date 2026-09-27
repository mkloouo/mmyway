import { probeAbout } from '../api/ff3/auth';
import { resolveAddress, withTimeout, type AddressProbeResult } from '../api/ff3/hosts';

export interface ReachabilityConfig {
  ff3: { addresses: string[]; apiToken: string; remembered: string | null } | null;
  // name -> that provider's addresses (e.g. every local-model URL), ordered
  providers: Record<string, { addresses: string[]; remembered: string | null }>;
}

export interface ServerReachability {
  winner: string | null;
  results: AddressProbeResult[]; // empty when not configured
}

export interface ReachabilityReport {
  ff3: ServerReachability;
  providers: Record<string, ServerReachability>;
}

/** Per-address results for both servers (design §6.6) — the sync sheet lists every address with
 * its own dot, not one collapsed boolean per server. */
export async function probeReachability(config: ReachabilityConfig): Promise<ReachabilityReport> {
  const ff3 = config.ff3
    ? await resolveAddress(
        config.ff3.addresses,
        config.ff3.remembered,
        withTimeout((address) => probeAbout(address, config.ff3!.apiToken).then((r) => r.ok)),
      )
    : { winner: null, results: [] };

  const providers: Record<string, ServerReachability> = {};
  await Promise.all(
    Object.entries(config.providers).map(async ([name, { addresses, remembered }]) => {
      providers[name] = await resolveAddress(
        addresses,
        remembered,
        withTimeout((address) => fetch(`${address.replace(/\/+$/, '')}/v1/models`, { method: 'GET' }).then((r) => r.ok).catch(() => false)),
      );
    }),
  );

  return { ff3, providers };
}
