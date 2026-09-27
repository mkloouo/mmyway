import * as SecureStore from 'expo-secure-store';
import { createFF3Client, type FF3Client } from './client';
import { probeAbout } from './auth';
import { readHosts, resolveAddress, withTimeout } from './hosts';
import { getFf3ActiveHost, setFf3ActiveHost } from '../../settings/appSettings';
import type { OutboxDb } from '../../sync/outbox';

const TOKEN_KEY = 'ff3_api_token'; // auth.ts owns writing it; read-only here

let memoAddress: string | null = null;
let memoClient: FF3Client | null = null;

/**
 * Resolves before building the client: tries the remembered address first, then the rest of
 * `readHosts()` in order (design §6.6). Re-memoises on the address that actually answered, not
 * on a stored one, so a later probe failure re-resolves instead of retrying a dead address.
 */
export async function getClient(db: OutboxDb): Promise<FF3Client | null> {
  const [hosts, apiToken] = await Promise.all([readHosts(), SecureStore.getItemAsync(TOKEN_KEY)]);
  if (hosts.length === 0 || !apiToken) {
    memoAddress = null;
    memoClient = null;
    return null;
  }
  if (memoClient && memoAddress && hosts.includes(memoAddress)) return memoClient;

  const remembered = await getFf3ActiveHost(db);
  const { winner } = await resolveAddress(hosts, remembered, withTimeout((address) => probeAbout(address, apiToken).then((r) => r.ok)));
  if (!winner) {
    memoAddress = null;
    memoClient = null;
    return null;
  }

  memoAddress = winner;
  memoClient = createFF3Client({ baseUrl: winner, apiToken });
  await setFf3ActiveHost(db, winner);
  return memoClient;
}
