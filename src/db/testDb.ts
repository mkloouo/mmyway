// Test-only driver, deliberately kept OUT of src/db/client.ts: better-sqlite3's migrator
// (drizzle-orm/better-sqlite3/migrator) imports node:crypto/node:fs at module scope, and
// Metro bundles every require()/import it finds in a file reachable from the app entry
// point, lazy or not, static or not — a real device build broke on exactly this before
// the split (see docs/handover.md). This file must never be imported by app code
// (app/**, src/db/client.ts, src/app/**) — only by Jest tests, which Metro never bundles.
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export function createTestDb(): BetterSQLite3Database<typeof schema> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle: drizzleBetterSqlite3 } = require('drizzle-orm/better-sqlite3');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { migrate: migrateBetterSqlite3 } = require('drizzle-orm/better-sqlite3/migrator');
  const sqlite = new Database(':memory:');
  const db = drizzleBetterSqlite3(sqlite, { schema });
  migrateBetterSqlite3(db, { migrationsFolder: './src/db/migrations' });
  return db;
}
