// Users won't reinstall to recover from a broken schema (review: "tested migrations"), so the
// upgrade path from the 1.0.0 schema is run against a database holding real rows.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MIGRATIONS = path.join(__dirname, 'migrations');
const RELEASE_1_0_0_LAST_IDX = 4; // migrations 0000–0004 shipped in 1.0.0

function journal(): { entries: { idx: number; tag: string }[] } {
  return JSON.parse(fs.readFileSync(path.join(MIGRATIONS, 'meta', '_journal.json'), 'utf8'));
}

describe('migrations', () => {
  it('upgrade a 1.0.0 database with data in it, keeping every row', () => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const Database = require('better-sqlite3');
    const { drizzle } = require('drizzle-orm/better-sqlite3');
    const { migrate } = require('drizzle-orm/better-sqlite3/migrator');
    /* eslint-enable @typescript-eslint/no-require-imports */

    // A copy of the folder whose journal stops at 1.0.0.
    const old = fs.mkdtempSync(path.join(os.tmpdir(), 'mmyway-migrations-'));
    fs.cpSync(MIGRATIONS, old, { recursive: true });
    const full = journal();
    fs.writeFileSync(path.join(old, 'meta', '_journal.json'), JSON.stringify({ ...full, entries: full.entries.filter((e) => e.idx <= RELEASE_1_0_0_LAST_IDX) }));

    const sqlite = new Database(':memory:');
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: old });
    sqlite.exec(`
      insert into reference_accounts (id, name, type, currency_code, active, synced_at) values ('a1', 'Revolut', 'asset', 'PLN', 1, 's');
      insert into cached_transactions (group_id, journal_id, type, date, amount, currency_code, description, source_name, destination_name, updated_at, synced_at)
        values ('g1', 'j1', 'withdrawal', '2026-09-01', '12.50', 'PLN', 'Żabka', 'Revolut', 'Żabka', 'u', 's');
      insert into inbox_items (id, kind, state, draft_json, created_at, updated_at) values ('i1', 'manual_entry', 'captured', '{}', 'c', 'u');
      insert into outbox_operations (id, kind, payload_json, status, attempts, created_at, sequence) values ('o1', 'update_account', '{}', 'failed', 2, 'c', 1);
    `);

    migrate(db, { migrationsFolder: MIGRATIONS });

    expect(sqlite.prepare('select include_net_worth, account_role from reference_accounts where id = ?').get('a1')).toEqual({ include_net_worth: 1, account_role: null });
    expect(sqlite.prepare('select amount, split_count, search_key from cached_transactions where group_id = ?').get('g1')).toEqual({ amount: '12.50', split_count: 1, search_key: null });
    expect(sqlite.prepare('select state from inbox_items where id = ?').get('i1')).toEqual({ state: 'captured' });
    expect(sqlite.prepare('select attempts, next_attempt_at from outbox_operations where id = ?').get('o1')).toEqual({ attempts: 2, next_attempt_at: null });
    fs.rmSync(old, { recursive: true, force: true });
  });

  it('every generated migration is registered in the app bundle glue (src/db/migrations.ts)', () => {
    const glue = fs.readFileSync(path.join(__dirname, 'migrations.ts'), 'utf8');
    for (const entry of journal().entries) {
      const key = `m${String(entry.idx).padStart(4, '0')}`;
      expect(glue).toContain(`import ${key} from './migrations/${entry.tag}.sql';`);
      expect(glue).toMatch(new RegExp(`migrations: \\{[^}]*\\b${key}\\b`));
    }
  });
});
