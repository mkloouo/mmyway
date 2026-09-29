// Which receipt reader is working on which Inbox item, so the "Reading receipt…" card can name it
// and follow the chain when it falls back to the next reader. In memory only: a read that outlives
// the app is retried by runSync, which sets it again.
import { useSyncExternalStore } from 'react';

const reading = new Map<string, string>();
const listeners = new Set<() => void>();

/** `name` is the reader now trying `itemId`; null once the chain is done with it. */
export function setReadingProvider(itemId: string, name: string | null): void {
  if (name) reading.set(itemId, name);
  else reading.delete(itemId);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useReadingProvider(itemId: string): string | null {
  return useSyncExternalStore(subscribe, () => reading.get(itemId) ?? null);
}
