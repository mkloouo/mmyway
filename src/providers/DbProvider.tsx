import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { InteractionManager, Text } from 'react-native';
import { warmMerchantLookup } from '../lookup/merchantLookup';
import { getDb, getMigrationDone, schema } from '../db/client';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';

type Db = ExpoSQLiteDatabase<typeof schema>;
const DbContext = createContext<Db | null>(null);

export function DbProvider({ children }: { children: ReactNode }) {
  // getDb() is synchronous and memoizes its own instance — no effect needed, and the lazy
  // useState initializer runs it exactly once, on mount, not on every render.
  const [db] = useState<Db>(() => getDb());
  const [migrated, setMigrated] = useState(false);

  useEffect(() => {
    getMigrationDone().finally(() => {
      setMigrated(true);
      // Preload capture's payee/account history once the first screen has drawn, so the first
      // +Add of the session opens as fast as later ones instead of scanning the cache on open.
      InteractionManager.runAfterInteractions(() => {
        warmMerchantLookup(db).catch(() => undefined);
      });
    });
  }, [db]);

  // Gates every screen behind migrations finishing — querying an unmigrated db races table
  // creation (see getMigrationDone's comment).
  if (!migrated) return <Text>Loading…</Text>;

  return <DbContext.Provider value={db}>{children}</DbContext.Provider>;
}

export function useDb(): Db {
  const db = useContext(DbContext);
  if (!db) throw new Error('useDb() called outside DbProvider');
  return db;
}
