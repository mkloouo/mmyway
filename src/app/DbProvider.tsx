import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getDb, schema } from '../db/client';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';

type Db = ExpoSQLiteDatabase<typeof schema>;
const DbContext = createContext<Db | null>(null);

export function DbProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<Db | null>(null);

  useEffect(() => {
    const instance = getDb();
    setDb(instance);
  }, []);

  if (!db) return null; // brief render gap while opening the sqlite file — no splash logic yet, revisit with Q11 UX
  return <DbContext.Provider value={db}>{children}</DbContext.Provider>;
}

export function useDb(): Db {
  const db = useContext(DbContext);
  if (!db) throw new Error('useDb() called outside DbProvider');
  return db;
}
