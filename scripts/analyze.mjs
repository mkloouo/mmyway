#!/usr/bin/env node
// Runs every static-analysis check (docs/STATIC_ANALYSIS.md) and prints one summary. Report-only
// by default: it always exits 0, so it can run anywhere without blocking. `--strict` exits 1 when a
// check fails — for CI, once the baseline is fixed and the checks are switched on.
//
//   npm run analyze                    all checks, report only
//   npm run analyze -- --strict        fail on any finding
//   npm run analyze -- lint cycles     just these

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

export const CHECKS = [
  { key: 'dead', script: 'analyze:dead', what: 'unused files, exports, dependencies (knip)' },
  { key: 'dupes', script: 'analyze:dupes', what: 'copy-paste over 1% (jscpd)' },
  { key: 'cycles', script: 'analyze:cycles', what: 'runtime import cycles (dpdm)' },
  {
    key: 'deps',
    script: 'analyze:deps',
    what: 'high/critical advisories in app dependencies (npm audit)',
  },
  {
    key: 'doctor',
    script: 'analyze:doctor',
    what: 'Expo config and dependency drift (expo-doctor)',
  },
];

/** The last line that says something, for the summary table. */
function gist(output) {
  const lines = output
    .split('\n')
    .map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').trim())
    .filter((l) => l && !/^(>|npm (warn|notice))|opencollective|gangsta/i.test(l));
  return (
    lines.find((l) =>
      /✖ \d+ problems?|problems? \(|Found \d+|circular|vulnerabilit|checks? (passed|failed)|Unused/i.test(
        l,
      ),
    ) ??
    lines.at(-1) ??
    ''
  ).slice(0, 100);
}

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const only = args.filter((a) => !a.startsWith('--'));
const checks = only.length ? CHECKS.filter((c) => only.includes(c.key)) : CHECKS;

let failed = 0;
const rows = [];
for (const check of checks) {
  process.stdout.write(`▶ ${check.key.padEnd(7)} ${check.what} … `);
  const t0 = Date.now();
  const r = spawnSync('npm', ['run', '-s', check.script], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const ok = r.status === 0;
  if (!ok) failed++;
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  console.log(`${ok ? '✔' : '✖'} ${Math.round((Date.now() - t0) / 1000)} s`);
  if (!ok)
    console.log(
      out
        .trim()
        .split('\n')
        .slice(-25)
        .map((l) => `    ${l}`)
        .join('\n'),
    );
  rows.push({ key: check.key, ok, gist: gist(out) });
}

console.log('\nSummary');
for (const row of rows) console.log(`  ${row.ok ? '✔' : '✖'} ${row.key.padEnd(7)} ${row.gist}`);
console.log(
  failed
    ? `\n${failed} of ${rows.length} checks have findings${strict ? '' : ' (report only — pass --strict to fail on them)'}`
    : '\nall checks clean',
);
if (strict && failed) process.exit(1);
