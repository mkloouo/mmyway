import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useDb } from '../app/DbProvider';
import { inboxItems } from '../db/schema';

export function useInboxItems() {
  const db = useDb();
  return useLiveQuery(db.select().from(inboxItems));
}
