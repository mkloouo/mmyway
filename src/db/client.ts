import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { drizzle as drizzleBetterSqlite3, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate as migrateBetterSqlite3 } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

let cached: ExpoSQLiteDatabase<typeof schema> | null = null;

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
  const sqlite = openDatabaseSync('mmyway.db');
  cached = drizzleExpo(sqlite, { schema }) as ExpoSQLiteDatabase<typeof schema>;
  migrateExpoSqlite(cached, migrations).catch((err: unknown) => {
    console.error('migration failed', err);
  });
  return cached;
}

export function createTestDb(): BetterSQLite3Database<typeof schema> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  const db = drizzleBetterSqlite3(sqlite, { schema });
  migrateBetterSqlite3(db, { migrationsFolder: './src/db/migrations' });
  return db;
}

export { schema };
