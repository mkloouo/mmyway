// Extra HTTP headers sent with every Firefly III request, for an instance behind an authenticating
// reverse proxy — Cloudflare Access (`CF-Access-Client-Id` / `CF-Access-Client-Secret`) is the case
// this exists for. They are credentials, so they live in SecureStore next to the API token, never
// in app_settings (which is documented non-secret).
//
// `createFF3Client` is synchronous and is called from the sign-in probe (src/api/ff3/auth.ts) as
// well as from the sync session, so rather than thread an extra argument through every call site
// the headers are kept as a module-level snapshot: `loadProxyHeaders()` fills it once at app start
// (app/_layout.tsx) and again after an edit, and the client reads `currentProxyHeaders()`.
//
// HTTP Basic in front of a Bearer API is deliberately NOT modelled here: both want the
// `Authorization` header, so one would have to lose. Put the credentials in the address instead
// (`https://user:pass@firefly.example.com`) — the host list already takes an arbitrary URL.
import * as SecureStore from 'expo-secure-store';

const KEY = 'ff3_proxy_headers';

/**
 * Headers the client sets itself. Overriding one of these breaks authentication or content
 * negotiation in a way that reads as a server fault, so they are refused on the way in.
 */
const RESERVED = ['authorization', 'accept', 'content-type', 'content-length', 'host'];

/** RFC 7230 `token`: what a header name is allowed to contain. */
const NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export type ProxyHeaderProblem = 'name' | 'reserved' | 'value';

/** Why this pair can't be stored, or null when it can. Drives the field errors on the screen. */
export function proxyHeaderProblem(name: string, value: string): ProxyHeaderProblem | null {
  if (!NAME.test(name)) return 'name';
  if (RESERVED.includes(name.toLowerCase())) return 'reserved';
  // A CR or LF in a value would let it inject a second header; an empty value is a no-op.
  if (value.trim() === '' || /[\r\n]/.test(value)) return 'value';
  return null;
}

/**
 * Only well-formed, non-reserved pairs survive. Applied on read as well as on write, so a map
 * stored by an older build (or hand-edited) can never put a bad header on the wire.
 */
export function sanitizeProxyHeaders(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'string') continue;
    if (proxyHeaderProblem(name, value)) continue;
    out[name] = value;
  }
  return out;
}

let snapshot: Record<string, string> = {};

/** What the client merges into every request. Empty until `loadProxyHeaders` has run. */
export function currentProxyHeaders(): Record<string, string> {
  return snapshot;
}

/** Reads SecureStore into the snapshot and returns it. Safe to call again; the screen does. */
export async function loadProxyHeaders(): Promise<Record<string, string>> {
  try {
    const stored = await SecureStore.getItemAsync(KEY);
    snapshot = sanitizeProxyHeaders(stored ? JSON.parse(stored) : {});
  } catch {
    // Unreadable or absent: no extra headers is the safe answer, and the screen can rewrite them.
    snapshot = {};
  }
  return snapshot;
}

export async function writeProxyHeaders(headers: Record<string, string>): Promise<void> {
  const clean = sanitizeProxyHeaders(headers);
  snapshot = clean;
  if (Object.keys(clean).length === 0) {
    await SecureStore.deleteItemAsync(KEY);
    return;
  }
  await SecureStore.setItemAsync(KEY, JSON.stringify(clean));
}

/** Test seam: set the snapshot without touching SecureStore. */
export function setProxyHeadersForTest(headers: Record<string, string>): void {
  snapshot = sanitizeProxyHeaders(headers);
}
