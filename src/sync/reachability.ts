import { probeAbout } from '../api/ff3/auth';

export interface ReachabilityConfig {
  ff3: { host: string; apiToken: string } | null;
  providers: Record<string, string>; // name -> health-check URL
}

export async function probeReachability(config: ReachabilityConfig): Promise<{ ff3: boolean; providers: Record<string, boolean> }> {
  const ff3 = config.ff3 ? (await probeAbout(config.ff3.host, config.ff3.apiToken)).ok : false;
  const providers: Record<string, boolean> = {};
  await Promise.all(
    Object.entries(config.providers).map(async ([name, url]) => {
      try {
        const response = await fetch(url, { method: 'GET' });
        providers[name] = response.ok;
      } catch {
        providers[name] = false;
      }
    }),
  );
  return { ff3, providers };
}
