import type { AuthErrorReason } from './types';

interface FF3ClientConfig {
  baseUrl: string; // e.g. https://firefly.example.com — no trailing slash, no /api suffix
  apiToken: string;
}

/**
 * How long one request may take, answer included, before it is aborted. React Native's fetch has no
 * timeout of its own (OkHttp is built with 0), so a half-open connection would otherwise hang the
 * single-flight sync — and with it every later sync — until the process is killed.
 */
export const REQUEST_TIMEOUT_MS = 20_000;
/** An attachment upload carries a whole photo over what may be a mobile connection. */
export const UPLOAD_TIMEOUT_MS = 60_000;

export type FF3RequestInit = RequestInit & { timeoutMs?: number };

export interface FF3Client {
  request<T>(path: string, init?: FF3RequestInit): Promise<T>;
  /** An `<Image source>` for an authenticated GET, e.g. an attachment download. */
  imageSource?(path: string): { uri: string; headers: Record<string, string> };
}

export function createFF3Client({ baseUrl, apiToken }: FF3ClientConfig): FF3Client {
  const apiRoot = `${baseUrl.replace(/\/+$/, '')}/api`;
  return {
    async request<T>(path: string, init: FF3RequestInit = {}): Promise<T> {
      const { timeoutMs = REQUEST_TIMEOUT_MS, signal: callerSignal, ...rest } = init;
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (callerSignal?.aborted) abort();
      else callerSignal?.addEventListener('abort', abort);
      const timer = setTimeout(abort, timeoutMs);
      try {
        const response = await fetch(`${apiRoot}${path}`, {
          ...rest,
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${apiToken}`,
            Accept: 'application/json',
            ...(rest.body ? { 'Content-Type': 'application/vnd.api+json' } : {}),
            ...rest.headers,
          },
        });
        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new FF3RequestError(response.status, body);
        }
        if (response.status === 204) return undefined as T;
        // Still under the timer: a body that never finishes arriving hangs just the same.
        return (await response.json()) as T;
      } catch (err) {
        // Hermes' abort may surface as a plain Error; serverUnavailable() keys on the name.
        if (controller.signal.aborted && !(err instanceof FF3RequestError)) {
          const timedOut = new Error(`FF3 request timed out: ${path}`);
          timedOut.name = 'AbortError';
          throw timedOut;
        }
        throw err;
      } finally {
        clearTimeout(timer);
        callerSignal?.removeEventListener('abort', abort);
      }
    },
    imageSource(path: string) {
      // The same Accept as request(): FF3's API refuses a request whose Accept header it doesn't
      // list, and a download sent none.
      return {
        uri: `${apiRoot}${path}`,
        headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' },
      };
    },
  };
}

export class FF3RequestError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`FF3 request failed: ${status}`);
  }
}

export function classifyProbeError(status: number, contentType: string | null): AuthErrorReason {
  if (status === 401) return 'invalid_api_key';
  if (contentType?.startsWith('text/html')) return 'invalid_api_key'; // reverse-proxy login redirect, see auth.dart
  return 'unexpected_status';
}
