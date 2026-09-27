import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import * as schema from './schema';

let cached: ExpoSQLiteDatabase<typeof schema> | null = null;
let migrationDone: Promise<void> | null = null;

export function getDb(): ExpoSQLiteDatabase<typeof schema> {
  if (cached) return cached;
  // Lazy import so this file can be imported from Jest (node) without pulling in expo-sqlite's
  // native binding, or the .sql-import babel transform migrations.ts needs — both are only
  // reached at runtime on-device.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { openDatabaseSync } = require('expo-sqlite');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle: drizzleExpo } = require('drizzle-orm/expo-sqlite');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { migrate: migrateExpoSqlite } = require('drizzle-orm/expo-sqlite/migrator');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const migrations = require('./migrations').default;
  // enableChangeListener is required for drizzle's useLiveQuery (src/inbox/useInboxSections.ts) —
  // without it expo-sqlite never fires onDatabaseChange, so screens only see writes made
  // elsewhere after a full reload.
  const sqlite = openDatabaseSync('mmyway.db', { enableChangeListener: true });
  cached = drizzleExpo(sqlite, { schema }) as ExpoSQLiteDatabase<typeof schema>;
  migrationDone = migrateExpoSqlite(cached, migrations).catch((err: unknown) => {
    console.error('migration failed', err);
  });
  return cached;
}

// Resolves once migrations have run (or failed) against the db getDb() returns. Callers that
// read/write before this resolves can race a not-yet-created table.
export function getMigrationDone(): Promise<void> {
  getDb();
  return migrationDone!;
}

export { schema };
