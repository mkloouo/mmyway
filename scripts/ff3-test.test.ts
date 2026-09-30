/// <reference types="node" />
// scripts/ff3-test.mjs's parts that need no Docker: the compose file an instance gets and what the
// seed expands to. The lifecycle itself (up, init, seed, snapshot, reset, down, destroy) needs a
// Docker daemon and is checked by hand: `npm run ff3:test -- fresh`, then `npm run e2e -- selftest`.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SCRIPT = path.join(__dirname, 'ff3-test.mjs');
const run = (...args: string[]) =>
  execFileSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      FF3_TEST_HOME: path.join(__dirname, '..', 'node_modules', '.ff3-test-jest'),
    },
  });

describe('ff3-test compose', () => {
  it('runs the patched image on SQLite, reachable over IPv4', () => {
    const compose = run('compose', '--port', '8099');
    const patches = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, '..', 'tools', 'ff3-test', 'patches', 'patches.json'),
        'utf8',
      ),
    );
    expect(compose).toContain(`image: fireflyiii/core:version-${patches.basedOn}`);
    expect(compose).toContain("- '8099:8080'");
    expect(compose).toContain('DB_CONNECTION: sqlite');
    expect(compose).toContain('NGINX_LISTEN_IP_PROTOCOL: ipv4');
    expect(compose).toContain('PASSPORT_PRIVATE_KEY: |');
    for (const patch of patches.patches) {
      expect(
        fs.existsSync(path.join(__dirname, '..', 'tools', 'ff3-test', 'patches', patch.file)),
      ).toBe(true);
      expect(compose).toContain(`${patch.file}:${patch.target}:ro'`);
    }
  });

  it('leaves the patches out with --no-patches', () => {
    expect(run('compose', '--no-patches')).not.toContain('/var/www/html/app/');
  });
});

describe('ff3-test seed --plan', () => {
  const groups = JSON.parse(run('seed', '--plan')) as {
    group_title?: string;
    transactions: { date: string; description: string; amount: string }[];
  }[];
  const today = new Date();
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  it('expands the monthly entries and names them by month', () => {
    const salaries = groups.filter((g) => g.transactions[0]!.description.startsWith('Salary '));
    expect(salaries).toHaveLength(7);
    expect(new Set(salaries.map((g) => g.transactions[0]!.description)).size).toBe(7);
    expect(salaries.every((g) => /^Salary \d{4}-\d{2}$/.test(g.transactions[0]!.description))).toBe(
      true,
    );
  });

  it('dates nothing in the future', () => {
    for (const g of groups) for (const t of g.transactions) expect(t.date <= iso(today)).toBe(true);
  });

  it('keeps the split group the flows rely on', () => {
    const shop = groups.find((g) => g.group_title === 'Weekly shop');
    expect(shop?.transactions.map((t) => t.amount)).toEqual(['40.00', '12.50']);
  });
});
