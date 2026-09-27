// Search over the synced account list (every account is already local via fetchAll, so this is
// instant and works offline). normkey folds case and diacritics, so "zabka" finds "Żabka" and
// "cash case" finds "Cash · Case · PLN". Prefix matches rank above substring matches; an empty
// query returns the list unchanged.
import { normkey } from '../lookup/normkey';

export function filterAccounts<T extends { name: string }>(accounts: T[], query: string): T[] {
  const q = normkey(query);
  if (!q) return accounts;
  const prefix: T[] = [];
  const substring: T[] = [];
  for (const account of accounts) {
    const key = normkey(account.name);
    if (key.startsWith(q)) prefix.push(account);
    else if (key.includes(q)) substring.push(account);
  }
  return [...prefix, ...substring];
}
