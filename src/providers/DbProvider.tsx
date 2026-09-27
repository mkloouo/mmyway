import { createContext, useContext, useState, type ReactNode } from 'react';
import { getDb, schema } from '../db/client';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';

type Db = ExpoSQLiteDatabase<typeof schema>;
const DbContext = createContext<Db | null>(null);

export function DbProvider({ children }: { children: ReactNode }) {
  // getDb() is synchronous and memoizes its own instance — no effect needed, and the lazy
  // useState initializer runs it exactly once, on mount, not on every render.
  const [db] = useState<Db>(() => getDb());
  return <DbContext.Provider value={db}>{children}</DbContext.Provider>;
}

export function useDb(): Db {
  const db = useContext(DbContext);
  if (!db) throw new Error('useDb() called outside DbProvider');
  return db;
}
