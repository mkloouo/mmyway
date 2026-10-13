// Thin client for a self-hosted Flagsmith (docs/FEATURE_FLAGS.md). Plain fetch, no SDK.
import Constants from 'expo-constants';
import { z } from 'zod';
import { isFlagName, type FlagValues } from './registry';

const FLAGS_TIMEOUT_MS = 5000;

const FlagsResponse = z.array(
  z.object({ feature: z.object({ name: z.string() }), enabled: z.boolean() }).passthrough(),
);

const FlagsmithExtra = z.object({ apiUrl: z.string(), environmentKey: z.string() });

type FlagsmithConfig = { apiUrl: string; environmentKey: string };

/** null unless both app.config.js values are set (no Flagsmith configured → code defaults apply). */
export function flagsmithConfig(): FlagsmithConfig | null {
  const parsed = FlagsmithExtra.safeParse(Constants.expoConfig?.extra?.flagsmith);
  if (!parsed.success || !parsed.data.apiUrl || !parsed.data.environmentKey) return null;
  return parsed.data;
}

/** Throws on a non-2xx answer, a malformed body or a timeout; the caller keeps its cache. */
export async function fetchFlags(
  config: FlagsmithConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<FlagValues> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FLAGS_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${config.apiUrl.replace(/\/+$/, '')}/flags/`, {
      headers: { 'X-Environment-Key': config.environmentKey, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`flagsmith HTTP ${response.status}`);
    const body = FlagsResponse.parse(await response.json());
    const values: FlagValues = {};
    for (const { feature, enabled } of body) {
      const name = feature.name;
      if (isFlagName(name)) values[name] = enabled;
    }
    return values;
  } finally {
    clearTimeout(timeout);
  }
}
