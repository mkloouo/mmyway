import * as SecureStore from 'expo-secure-store';
import { createFF3Client, classifyProbeError, type FF3Client } from './client';
import type { SystemInfo, CurrencyRead, AuthErrorReason } from './types';

const MIN_API_VERSION = [6, 3, 2] as const;
const HOST_KEY = 'ff3_host';
const TOKEN_KEY = 'ff3_api_token';

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
    return { ok: false, reason: classifyProbeError(response.status, response.headers.get('content-type')) };
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

export async function signIn(host: string, apiToken: string): Promise<SignInResult> {
  const baseUrl = host.trim().replace(/\/+$/, '');
  const token = apiToken.trim();
  const probe = await probeAbout(baseUrl, token);
  if (!probe.ok) return probe;

  const client = createFF3Client({ baseUrl, apiToken: token });
  const currency = await client.request<{ data: CurrencyRead }>('/v1/currencies/primary');

  await SecureStore.setItemAsync(HOST_KEY, baseUrl);
  await SecureStore.setItemAsync(TOKEN_KEY, token);

  return {
    ok: true,
    client,
    apiVersion: probe.apiVersion,
    defaultCurrencyCode: currency.data.attributes.code,
  };
}

export async function readStoredCredentials(): Promise<{ host: string; apiToken: string } | null> {
  const [host, apiToken] = await Promise.all([
    SecureStore.getItemAsync(HOST_KEY),
    SecureStore.getItemAsync(TOKEN_KEY),
  ]);
  if (!host || !apiToken) return null;
  return { host, apiToken };
}

export async function signOut(): Promise<void> {
  await SecureStore.deleteItemAsync(HOST_KEY);
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}
