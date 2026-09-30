// Which receipt reader is working on which Inbox item, so the "Reading receipt…" card can name it
// and follow the chain when it falls back to the next reader, and which items no reader could be
// reached for, so their card says it is waiting rather than reading. In memory only: a read that
// outlives the app is retried by runSync, which sets both again.
import { useSyncExternalStore } from 'react';

const reading = new Map<string, string>();
const waiting = new Set<string>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** `name` is the reader now trying `itemId`; null once the chain is done with it. */
export function setReadingProvider(itemId: string, name: string | null): void {
  if (name) {
    reading.set(itemId, name);
    waiting.delete(itemId);
  } else reading.delete(itemId);
  notify();
}

/** No reader answered for `itemId` (offline, the PC asleep): it waits for the next sync's retry. */
export function setWaitingForReader(itemId: string, isWaiting: boolean): void {
  if (isWaiting) waiting.add(itemId);
  else waiting.delete(itemId);
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useReadingProvider(itemId: string): string | null {
  return useSyncExternalStore(subscribe, () => reading.get(itemId) ?? null);
}

export function useWaitingForReader(itemId: string): boolean {
  return useSyncExternalStore(subscribe, () => waiting.has(itemId));
}
