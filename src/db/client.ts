import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import * as schema from './schema';

let cached: ExpoSQLiteDatabase<typeof schema> | null = null;
let migrationDone: Promise<Error | null> | null = null;

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
  // WAL is what makes the change-listener design above survivable. drizzle's expo-sqlite session
  // calls `prepareSync` per query and never finalizes the statement, and a sync fires the change
  // listener once per upserted row, so every mounted useLiveQuery re-prepares and leaves another
  // open read behind. Under the default rollback journal an open read blocks every write, and the
  // next write dies with "Call to function 'NativeStatement.runSync' has been rejected... database
  // is locked" — for the life of the connection, which is why it survived reopening the app.
  // In WAL a reader never blocks the writer; busy_timeout makes the rest wait rather than throw.
  // Switching journal mode needs the write lock, which is exactly what a database already stuck
  // in this state is holding — so a failure here must not become a crash before the app opens.
  try {
    sqlite.execSync('PRAGMA journal_mode = WAL;');
    sqlite.execSync('PRAGMA busy_timeout = 5000;');
  } catch (err) {
    console.error('could not set WAL/busy_timeout', err);
  }
  cached = drizzleExpo(sqlite, { schema }) as ExpoSQLiteDatabase<typeof schema>;
  migrationDone = migrateExpoSqlite(cached, migrations).then(
    () => null,
    (err: unknown) => {
      // Every later query would break in ways that look unrelated, so the app must not run on
      // this schema: DbProvider shows a blocking screen with the Diagnostics log instead.
      console.error('migration failed', err);
      return err instanceof Error ? err : new Error(String(err));
    },
  );
  return cached;
}

// Resolves once migrations have run against the db getDb() returns: null, or the error they
// failed with. Callers that read/write before this resolves can race a not-yet-created table.
export function getMigrationDone(): Promise<Error | null> {
  getDb();
  return migrationDone!;
}

export { schema };
