import * as SecureStore from 'expo-secure-store';
import { createFF3Client, FF3RequestError, type FF3Client } from './client';
import { probeAbout, TOKEN_KEY } from './auth';
import { readHosts, resolveAddress, withTimeout } from './hosts';
import { getFf3ActiveHost, setFf3ActiveHost } from '../../settings/appSettings';
import type { OutboxDb } from '../../sync/outbox';

// One client per (address, token). Keyed on the token too: signing in again against the same
// host with a new token must not keep sending the old one.
let memo: { address: string; token: string; client: FF3Client } | null = null;

/**
 * The client for an address that has just answered (runSync resolves it with the reachability
 * probe, design §6.6). A request that fails at the network level forgets the memo, so the next
 * caller re-resolves instead of retrying an address that went away — leaving home Wi-Fi used to
 * pin every sync to the dead LAN address until the app was killed. An HTTP error (the server
 * answered) keeps it.
 */
export function clientFor(address: string, token: string): FF3Client {
  if (memo && memo.address === address && memo.token === token) return memo.client;
  const inner = createFF3Client({ baseUrl: address, apiToken: token });
  const client: FF3Client = {
    async request<T>(path: string, init?: RequestInit): Promise<T> {
      try {
        return await inner.request<T>(path, init);
      } catch (err) {
        if (!(err instanceof FF3RequestError) && memo?.client === client) memo = null;
        throw err;
      }
    },
  };
  memo = { address, token, client };
  return client;
}

export function resetClient(): void {
  memo = null;
}

/**
 * For callers outside a sync (Activity's older-history pull): reuses the memoised client while
 * it is still configured and working, otherwise resolves an address the same way runSync does —
 * remembered one first, then the rest in order.
 */
export async function getClient(db: OutboxDb): Promise<FF3Client | null> {
  const [hosts, apiToken] = await Promise.all([readHosts(), SecureStore.getItemAsync(TOKEN_KEY)]);
  if (hosts.length === 0 || !apiToken) {
    memo = null;
    return null;
  }
  if (memo && memo.token === apiToken && hosts.includes(memo.address)) return memo.client;

  const remembered = await getFf3ActiveHost(db);
  const { winner } = await resolveAddress(hosts, remembered, withTimeout((address) => probeAbout(address, apiToken).then((r) => r.ok)));
  if (!winner) {
    memo = null;
    return null;
  }
  await setFf3ActiveHost(db, winner);
  return clientFor(winner, apiToken);
}
