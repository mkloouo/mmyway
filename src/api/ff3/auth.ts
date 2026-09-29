import * as SecureStore from 'expo-secure-store';
import { createFF3Client, classifyProbeError, type FF3Client } from './client';
import { readHosts, writeHosts } from './hosts';
import type { SystemInfo, CurrencyRead, AuthErrorReason } from './types';

const MIN_API_VERSION = [6, 3, 2] as const;
const LEGACY_HOST_KEY = 'ff3_host';
export const TOKEN_KEY = 'ff3_api_token';

export type SignInResult =
  | { ok: true; client: FF3Client; apiVersion: string; defaultCurrencyCode: string }
  | { ok: false; reason: AuthErrorReason };

function parseVersion(raw: string): [number, number, number] | null {
  const value = raw.startsWith('develop/') ? '99.9.9' : raw;
  const parts = value.split('.').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  return parts as [number, number, number];
}

function isBelowMin(version: [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) {
    if (version[i]! !== MIN_API_VERSION[i]!) return version[i]! < MIN_API_VERSION[i]!;
  }
  return false;
}

export async function probeAbout(
  baseUrl: string,
  apiToken: string,
): Promise<{ ok: true; apiVersion: string } | { ok: false; reason: AuthErrorReason }> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/v1/about`, {
      headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
    });
  } catch {
    return { ok: false, reason: 'invalid_host' };
  }
  if (!response.ok) {
    return {
      ok: false,
      reason: classifyProbeError(response.status, response.headers.get('content-type')),
    };
  }
  const contentType = response.headers.get('content-type');
  if (contentType?.startsWith('text/html')) {
    return { ok: false, reason: 'invalid_api_key' };
  }
  let body: SystemInfo;
  try {
    body = (await response.json()) as SystemInfo;
  } catch {
    return { ok: false, reason: 'not_a_firefly_instance' };
  }
  const version = parseVersion(body.data?.api_version ?? '');
  if (!version) return { ok: false, reason: 'not_a_firefly_instance' };
  if (isBelowMin(version)) return { ok: false, reason: 'api_version_too_low' };
  return { ok: true, apiVersion: body.data.api_version };
}

// Signing in starts a fresh address list with the one the user entered — one token covers every
// FF3 address (they are routes to the same instance), but a new sign-in is a new instance.
// Additional addresses for this instance are added afterward via the Addresses sheet.
export async function signIn(host: string, apiToken: string): Promise<SignInResult> {
  const baseUrl = host.trim().replace(/\/+$/, '');
  const token = apiToken.trim();
  const probe = await probeAbout(baseUrl, token);
  if (!probe.ok) return probe;

  const client = createFF3Client({ baseUrl, apiToken: token });
  const currency = await client.request<{ data: CurrencyRead }>('/v1/currencies/primary');

  await writeHosts([baseUrl]);
  await SecureStore.setItemAsync(TOKEN_KEY, token);

  return {
    ok: true,
    client,
    apiVersion: probe.apiVersion,
    defaultCurrencyCode: currency.data.attributes.code,
  };
}

/**
 * Back-compat shape for simple callers that just need "a" configured host (is anything set up
 * at all) — the first address in the list, not necessarily the one that last answered. Multi-
 * address resolution (src/api/ff3/session.ts, src/sync/reachability.ts) reads `readHosts()`
 * directly instead.
 */
export async function readStoredCredentials(): Promise<{ host: string; apiToken: string } | null> {
  const [hosts, apiToken] = await Promise.all([readHosts(), SecureStore.getItemAsync(TOKEN_KEY)]);
  if (hosts.length === 0 || !apiToken) return null;
  return { host: hosts[0]!, apiToken };
}

export async function signOut(): Promise<void> {
  await writeHosts([]);
  await SecureStore.deleteItemAsync(LEGACY_HOST_KEY);
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}
