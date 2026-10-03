#!/usr/bin/env node
// `npm run analyze:deps` — high and critical advisories in what the app ships, with an allowlist.
//
// Plain `npm audit --omit=dev --audit-level=high` flapped: it asks GitHub's advisory service at run
// time, so a commit that touches no dependency fails because an advisory published or widened its
// affected range overnight. That is what broke the Static analysis workflow on 2026-10-02/03 —
// node-forge's and braces' advisories were both *updated* within hours of the last green run, with
// no change to package-lock.json.
//
// `--omit=dev` also can't do what the check claims. `expo` is a production dependency and drags in
// `@expo/cli` — Metro's bundler, prebuild, expo-updates' code signing — so every advisory in the
// build toolchain counts as "ships in the app", when none of it is in the APK's JS bundle. Nothing
// under `app/` or `src/` imports it, and Metro bundles from the app entry point.
//
// So: the gate stays, and anything new still fails the build; an advisory is skipped only once it
// is written down here with what it reaches us through and why it doesn't ship.
import { spawnSync } from 'node:child_process';

/**
 * Re-check each of these whenever Expo's SDK is bumped: the fix arrives as a new `@expo/cli`, not
 * as anything this repo can do. Delete the entry when the advisory stops being reported.
 */
export const ALLOWED = [
  {
    id: 'GHSA-vfj7-8cjw-p6xm',
    package: 'braces',
    through: 'expo → @expo/cli → @expo/metro-file-map → micromatch → braces',
    why: "Metro's file map, used to bundle the app on a build machine; it is not in the bundle. npm's suggested fix (jest@30) is for a different tree and fixes nothing here.",
  },
  {
    id: 'GHSA-86w9-cpqp-85rv',
    package: 'node-forge',
    through: 'expo → @expo/cli (and @expo/code-signing-certificates)',
    why: 'Expo CLI tooling — signing expo-updates manifests on a build machine. No fix is published for node-forge.',
  },
];

const RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

/** Every advisory at `level` or worse in the audit's JSON, flattened out of npm's dependency graph. */
export function advisoriesIn(report, level = 'high') {
  const found = new Map(); // by advisory id: npm repeats one under every package it reaches
  for (const vuln of Object.values(report?.vulnerabilities ?? {}))
    for (const via of vuln.via ?? [])
      if (typeof via === 'object' && (RANK[via.severity] ?? 0) >= RANK[level])
        found.set(via.url?.split('/').pop() ?? `${via.source}`, {
          id: via.url?.split('/').pop() ?? `${via.source}`,
          package: via.name,
          severity: via.severity,
          title: via.title,
        });
  return [...found.values()];
}

/** What the run should say: what must fail the build, and which allowlist entries have gone stale. */
export function review(report, allowed = ALLOWED, level = 'high') {
  const found = advisoriesIn(report, level);
  const byId = new Set(found.map((a) => a.id));
  return {
    blocking: found.filter((a) => !allowed.some((k) => k.id === a.id)),
    skipped: allowed.filter((k) => byId.has(k.id)),
    stale: allowed.filter((k) => !byId.has(k.id)),
  };
}

function main() {
  // npm runs a script from the package root, which is where the lockfile this audits lives.
  const r = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    shell: process.platform === 'win32',
  });
  // A non-zero exit is how npm reports findings, so only unparseable output is a real failure.
  let report;
  try {
    report = JSON.parse(r.stdout);
  } catch {
    console.error(`npm audit gave nothing to read.\n${r.stderr || r.stdout}`);
    process.exit(1);
  }

  const { blocking, skipped, stale } = review(report);
  for (const a of skipped) console.log(`skipped ${a.id} (${a.package}) — ${a.through}: ${a.why}`);
  for (const a of stale)
    console.log(`${a.id} (${a.package}) is no longer reported — drop it from ALLOWED.`);
  if (blocking.length === 0) {
    console.log(`No unreviewed high or critical advisories (${skipped.length} allowlisted).`);
    return;
  }
  console.error(`\n${blocking.length} high or critical advisory(ies) to deal with:`);
  for (const a of blocking)
    console.error(
      `  ${a.severity}  ${a.package}  ${a.title}\n    https://github.com/advisories/${a.id}`,
    );
  console.error(
    '\nFix it, or — if it only reaches the app through build tooling — add it to ALLOWED in scripts/audit.mjs with the path and the reason.',
  );
  process.exit(1);
}

// Run as a script, not when a test imports the two pure functions above.
if (process.argv[1]?.endsWith('audit.mjs')) main();
