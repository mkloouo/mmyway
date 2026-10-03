// FF3 is always sent accounts by id, never by name. Names are ambiguous (an expense and an asset
// account can share one) and not every endpoint takes them: a recurring transaction's API drops
// source_name/destination_name and then fails part-way through saving, leaving a recurrence with
// no transaction that breaks FF3's whole Recurring page. So a split queued with only a name — a
// new payee, or one picked from history — has the name turned into an id when it is sent: the
// FF3 account with that name, or for a payee, a new expense/revenue account if there is none.
// Own accounts are never created: an unknown one is an error.
import type { FF3Client } from '../api/ff3/client';

import { createFF3Service } from '../api/ff3/service';
import type { OutboxDb } from './outbox';

type TxType = 'withdrawal' | 'deposit' | 'transfer';
type End = 'source' | 'destination';

/** Resolves names to ids, remembering each so splits sharing a payee don't look it up twice. */
export function accountResolver(client: FF3Client, db?: OutboxDb) {
  const known = new Map<string, Promise<string>>();
  const service = createFF3Service(client, db);

  return function accountId(type: TxType, end: End, name: string): Promise<string> {
    const key = `${type}\n${end}\n${name.trim().toLowerCase()}`;
    if (!known.has(key)) {
      known.set(key, service.accounts.resolve(type, end, name));
    }
    return known.get(key)!;
  };
}

type AccountResolver = ReturnType<typeof accountResolver>;

type AccountEnds = {
  type?: string;
  source_id?: string | number | null;
  source_name?: string | null;
  destination_id?: string | number | null;
  destination_name?: string | null;
};

/**
 * The split as FF3 is sent it: each end that has only a name gets the id for it, and names are
 * dropped wherever there is an id. `fallbackType` is for a partial edit that doesn't carry its type.
 */
export async function withAccountIds<T extends AccountEnds>(
  resolve: AccountResolver,
  split: T,
  fallbackType?: TxType,
): Promise<T & AccountEnds> {
  const out: T & AccountEnds = { ...split };
  const type = (split.type ?? fallbackType) as TxType | undefined;
  for (const end of ['source', 'destination'] as const) {
    const idKey = `${end}_id` as const;
    const nameKey = `${end}_name` as const;
    const name = out[nameKey]?.trim();
    if (!out[idKey] && name) {
      if (!type) throw new Error(`Cannot tell which kind of account "${name}" is.`);
      out[idKey] = await resolve(type, end, name);
    }
    if (out[idKey]) delete out[nameKey];
  }
  return out;
}
