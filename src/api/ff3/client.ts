import type { AuthErrorReason } from './types';

export interface FF3ClientConfig {
  baseUrl: string; // e.g. https://firefly.example.com — no trailing slash, no /api suffix
  apiToken: string;
}

export interface FF3Client {
  request<T>(path: string, init?: RequestInit): Promise<T>;
  /** An `<Image source>` for an authenticated GET, e.g. an attachment download. */
  imageSource?(path: string): { uri: string; headers: Record<string, string> };
}

export function createFF3Client({ baseUrl, apiToken }: FF3ClientConfig): FF3Client {
  const apiRoot = `${baseUrl.replace(/\/+$/, '')}/api`;
  return {
    async request<T>(path: string, init: RequestInit = {}): Promise<T> {
      const response = await fetch(`${apiRoot}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${apiToken}`,
          Accept: 'application/json',
          ...(init.body ? { 'Content-Type': 'application/vnd.api+json' } : {}),
          ...init.headers,
        },
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new FF3RequestError(response.status, body);
      }
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
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
