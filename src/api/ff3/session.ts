import { readStoredCredentials } from './auth';
import { createFF3Client, type FF3Client } from './client';

let memoHost: string | null = null;
let memoClient: FF3Client | null = null;

export async function getClient(): Promise<FF3Client | null> {
  const credentials = await readStoredCredentials();
  if (!credentials) {
    memoHost = null;
    memoClient = null;
    return null;
  }
  if (memoClient && memoHost === credentials.host) return memoClient;
  memoHost = credentials.host;
  memoClient = createFF3Client({ baseUrl: credentials.host, apiToken: credentials.apiToken });
  return memoClient;
}
