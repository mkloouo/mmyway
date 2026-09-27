import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
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

export { schema };
