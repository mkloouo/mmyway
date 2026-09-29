#!/usr/bin/env node
// Release pipeline: named steps, each runnable on its own, chained into a release that picks up
// where it stopped when re-run. The same script runs locally and in GitHub Actions
// (.github/workflows/release.yml). `npm run release -- --help` for usage.
//
// Adding a step (an AAB for Google Play, a local iOS build, a TestFlight upload):
//   1. write a function that does it; a build step puts its files in `ctx.outDir` and calls
//      writeChecksums(ctx), so SHA256SUMS and the GitHub release pick them up;
//   2. add it to STEPS with a line of help, and `done` if a re-run of the release may skip it;
//   3. add it to RELEASE where it belongs (a build before `commit`, an upload after it), or
//      leave it out to keep it a step that only runs when asked for.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = 'mmyway';
// Who may release. In GitHub Actions the workflow's actor is checked; locally, the `gh` login
// is, before anything is pushed. The workflow also refuses anyone else, and its secrets live in
// a `release` environment only this account can deploy to.
const RELEASERS = ['mkloouo'];

const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.chdir(ROOT);
const IN_GITHUB_ACTIONS = process.env.GITHUB_ACTIONS === 'true';

// ---------- helpers ----------

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

function step(message) {
  console.log(`\n▶ ${message}`);
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) fail(`\`${cmd} ${args.join(' ')}\` failed (exit ${r.status})`);
}

function out(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function succeeds(cmd, args) {
  return spawnSync(cmd, args, { stdio: 'ignore' }).status === 0;
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v ?? '');
  return m && m.slice(1).map(Number);
}

function isNewer(a, b) {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// A GitHub remote is optional: without one (or without an authenticated `gh`) a release still
// ends with tagged, checksummed APKs in releases/vX.Y.Z/, it just isn't published.
const hasRemote = () => succeeds('git', ['remote', 'get-url', 'origin']);
const hasGh = () => succeeds('gh', ['auth', 'status']);
const canPublishToGitHub = () => hasRemote() && hasGh();

function assertReleaser() {
  const who = IN_GITHUB_ACTIONS
    ? process.env.GITHUB_ACTOR
    : spawnSync('gh', ['api', 'user', '--jq', '.login'], { encoding: 'utf8' }).stdout?.trim();
  if (!RELEASERS.includes(who))
    fail(`${who || 'this account'} may not release ${APP} (only ${RELEASERS.join(', ')})`);
}

// ---------- args ----------

const HELP = `Release mmyway: tagged, checksummed Android APKs, published on GitHub.

Usage:
  npm run release -- X.Y.Z [--pause]   the whole release, or the rest of one that stopped
  npm run release -- <step> X.Y.Z      one step of it
  npm run release -- abort X.Y.Z       undo an unpushed release
  npm run release -- build             production split APKs of the current tree, no release
  npm run release -- --help

A release runs these steps in order. Re-running it skips the steps already done, so after a
failed build or upload, fix the cause and run the same command again.
  prepare          on main with a clean tree; X.Y.Z newer than package.json; no vX.Y.Z tag
                   or GitHub release yet. Type-check and tests. Then, left uncommitted:
                   CHANGELOG.md's [Unreleased] moves under "## [X.Y.Z] - <today>", and the
                   version goes into package.json, package-lock.json and app.config.js.
  build-android    local EAS build (production profile): one APK per ABI plus a universal one,
                   checked, renamed and listed in SHA256SUMS. Always rebuilds when run alone.
  commit           the "release vX.Y.Z" commit of those files, and an annotated vX.Y.Z tag.
                   Only after the build succeeded, so a failed build leaves no commit behind.
  publish-github   push main and the tag together, then a draft GitHub release with every file
                   and CHANGELOG.md's [X.Y.Z] section as notes, then published as latest. Safe
                   to re-run if it failed partway. Without a GitHub remote or \`gh\`, stops at the
                   local tag.

Options:
  --pause     Stop after the build, before committing, to try the APKs on a phone first. Run
              \`npm run release -- X.Y.Z\` again to finish, or \`abort X.Y.Z\` to drop it.
  -h, --help  Show this help.

abort drops an unpushed release commit and its tag, and restores the version files, whether
the release got to \`commit\` or not. It refuses once anything is on origin.

Only ${RELEASERS.join(', ')} may release: in GitHub Actions the workflow's actor is checked,
locally the \`gh\` login, before anything is pushed.

Release notes:
  The GitHub release body is CHANGELOG.md's "## [X.Y.Z]" section, verbatim. Write [Unreleased]
  for the person installing the app, since it becomes that.

Output (gitignored):
  releases/vX.Y.Z/: ${APP}-vX.Y.Z-<abi>.apk for arm64-v8a, armeabi-v7a, x86, x86_64 and
  universal; SHA256SUMS; release-notes.md.
  releases/v<version>-<commit>/ for \`build\`, the same files named after that.
`;

const STEPS = {
  prepare: { run: prepare, done: isPrepared },
  'build-android': {
    run: (c) => {
      assertPrepared();
      buildAndroid(c);
    },
    done: artifactsVerified,
    rerunnable: true,
  },
  commit: { run: commitRelease, done: isCommitted },
  'publish-github': { run: publishGitHub },
};
const RELEASE = ['prepare', 'build-android', 'commit', 'publish-github'];
const PAUSE_AFTER = 'build-android';

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write(HELP);
  process.exit(0);
}

const positional = argv.filter((a) => !a.startsWith('-'));
// A mistyped flag must not fall through to a full release.
const RENAMED = {
  '--publish': 'run `npm run release -- X.Y.Z` again to finish, or `publish-github X.Y.Z`',
  '--abort': 'it is `npm run release -- abort X.Y.Z` now',
};
for (const a of argv.filter((a) => a.startsWith('-'))) {
  if (a === '--pause') continue;
  fail(
    RENAMED[a]
      ? `${a} is gone: ${RENAMED[a]}`
      : `unknown argument "${a}" — see \`npm run release -- --help\``,
  );
}
const pause = argv.includes('--pause');

const [first, second, ...extra] = positional;
const command = parseVersion(first) ? 'release' : first;
const version = command === 'release' ? first : second;
const usage = 'see `npm run release -- --help`';
if (!command) fail(`usage: npm run release -- X.Y.Z [--pause] — ${usage}`);
if (command !== 'release' && command !== 'build' && command !== 'abort' && !STEPS[command])
  fail(`unknown step "${command}" — ${usage}`);
if (command === 'build' ? second !== undefined : !parseVersion(version))
  fail(
    command === 'build' ? `build takes no version — ${usage}` : `${command} needs X.Y.Z — ${usage}`,
  );
if (extra.length > 0 || (command === 'release' && second !== undefined))
  fail(`unexpected "${[second, ...extra].filter(Boolean).join(' ')}" — ${usage}`);
if (pause && command !== 'release') fail(`--pause only goes with a whole release — ${usage}`);

if (IN_GITHUB_ACTIONS) assertReleaser();

// ---------- release state ----------

const tag = `v${version}`;
const releaseSubject = `release ${tag}`;
const ctx = { label: tag, outDir: path.join('releases', tag) };

const headSubject = () => out('git', ['log', '-1', '--format=%s']);
const readPkgVersion = () => JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const versionFiles = () =>
  ['CHANGELOG.md', 'package.json', 'package-lock.json', 'app.config.js'].filter((f) =>
    fs.existsSync(f),
  );
// `-z`, untrimmed: each entry is "XY path", and X is a space for an unstaged change.
const changedFiles = () =>
  execFileSync('git', ['status', '--porcelain', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .map((entry) => entry.slice(3));
const localTagExists = () => succeeds('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`]);

function assertOnMain() {
  if (out('git', ['branch', '--show-current']) !== 'main') fail('not on main');
}

function assertCleanMain() {
  assertOnMain();
  if (changedFiles().length > 0)
    fail('working tree is not clean (commit, stash or gitignore first)');
}

// Prepared: this release's version files are changed or committed, and nothing else has
// changed — so an older release at the same version (a clean tree past it) doesn't count.
function isPrepared() {
  if (readPkgVersion() !== version) return false;
  const changed = changedFiles();
  const inProgress =
    headSubject() === releaseSubject || changed.some((f) => versionFiles().includes(f));
  if (!inProgress) return false;
  const stray = changed.filter((f) => !versionFiles().includes(f));
  if (stray.length > 0) fail(`release ${version} is prepared, but ${stray.join(', ')} changed too`);
  return true;
}

function assertPrepared() {
  assertOnMain();
  if (!isPrepared()) fail(`package.json isn't at ${version} — run \`prepare ${version}\` first`);
}

function isCommitted() {
  if (headSubject() !== releaseSubject) return false;
  if (!localTagExists()) return false;
  if (out('git', ['rev-list', '-n1', tag]) !== out('git', ['rev-parse', 'HEAD']))
    fail(`tag ${tag} exists but isn't on the release commit`);
  return true;
}

// CHANGELOG.md's "## [name]" section; [1] is its body, up to the next "## [".
function changelogSection(changelog, name) {
  const heading = name.replace(/\./g, '\\.');
  return new RegExp(`^## \\[${heading}\\][^\\n]*\\n([\\s\\S]*?)(?=^## \\[|(?![\\s\\S]))`, 'm').exec(
    changelog,
  );
}

// ---------- prepare ----------

function preflight() {
  step('Preflight');
  assertCleanMain();

  const current = readPkgVersion();
  if (!isNewer(version, current)) fail(`${version} is not newer than the current ${current}`);
  if (localTagExists()) fail(`tag ${tag} already exists locally`);

  if (hasRemote()) {
    run('git', ['fetch', '--quiet', 'origin']);
    if (out('git', ['rev-list', '--count', 'HEAD..origin/main']) !== '0')
      fail('main is behind origin/main — pull first');
    if (out('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]) !== '')
      fail(`tag ${tag} already exists on origin`);
    if (hasGh() && succeeds('gh', ['release', 'view', tag]))
      fail(`GitHub release ${tag} already exists`);
  }
}

function checks() {
  step('Type-check');
  run('npx', ['tsc', '--noEmit']);
  step('Tests');
  run('npx', ['jest', '--ci']);
}

function bumpVersionFiles() {
  step(`Version files → ${version}`);
  const changelog = fs.readFileSync('CHANGELOG.md', 'utf8');
  const m = changelogSection(changelog, 'Unreleased');
  if (!m || m[1].trim() === '') fail('CHANGELOG.md has nothing under [Unreleased]');
  const released = `## [Unreleased]\n\n## [${version}] - ${today()}\n\n${m[1].trim()}\n\n`;

  const bump = (file, re) => {
    const text = fs.readFileSync(file, 'utf8');
    if (!re.test(text)) fail(`couldn't find the version string in ${file}`);
    return text.replace(re, (s) => s.replace(/\d+\.\d+\.\d+/, version));
  };
  // Every file is read and checked before any is written, so a refusal leaves none changed.
  const writes = [
    [
      'CHANGELOG.md',
      changelog.slice(0, m.index) + released + changelog.slice(m.index + m[0].length),
    ],
    ['package.json', bump('package.json', /"version": "\d+\.\d+\.\d+"/)],
    ['app.config.js', bump('app.config.js', /version: '\d+\.\d+\.\d+'/)],
  ];
  // The lockfile carries the app's own version twice; left alone, it lagged a release behind
  // until the next `npm install` rewrote it.
  if (fs.existsSync('package-lock.json')) {
    const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
    lock.version = version;
    if (lock.packages?.['']) lock.packages[''].version = version;
    writes.push(['package-lock.json', JSON.stringify(lock, null, 2) + '\n']);
  }
  for (const [file, text] of writes) fs.writeFileSync(file, text);
}

function prepare() {
  preflight();
  checks();
  fs.rmSync(ctx.outDir, { recursive: true, force: true });
  bumpVersionFiles();
}

// ---------- build ----------

// With ABI splits on (eas.json's production profile), a local build writes a .tar.gz of every
// APK rather than one .apk. The build takes the working tree as it is, uncommitted version
// files included (eas.json doesn't set requireCommit), which is what lets `commit` come after it.
function buildAndroid({ label, outDir }) {
  step('Android build (production, local)');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const archive = path.join(outDir, 'android-build.tar.gz');
  run('npx', [
    'eas-cli',
    'build',
    '--platform',
    'android',
    '--profile',
    'production',
    '--local',
    '--non-interactive',
    '--output',
    archive,
  ]);

  const raw = path.join(outDir, 'android-raw');
  fs.mkdirSync(raw, { recursive: true });
  run('tar', ['-xzf', archive, '-C', raw]);

  const apks = new Map();
  for (const file of fs.readdirSync(raw, { recursive: true })) {
    const abi = /(?:^|\/)app-(.+)-release\.apk$/.exec(file)?.[1];
    if (abi) apks.set(abi, path.join(raw, file));
  }

  // The universal APK carries every ABI the build targets; there must be
  // exactly one split APK per ABI, each holding only its own native libs.
  const libAbis = (apk) =>
    new Set(
      out('unzip', ['-Z1', apk])
        .split('\n')
        .map((e) => /^lib\/([^/]+)\//.exec(e)?.[1])
        .filter(Boolean),
    );
  if (!apks.has('universal'))
    fail(
      `no universal APK in the build output (found: ${[...apks.keys()].join(', ') || 'nothing'})`,
    );
  const abis = [...libAbis(apks.get('universal'))].sort();
  const splits = [...apks.keys()].filter((k) => k !== 'universal').sort();
  if (abis.length === 0 || abis.join() !== splits.join()) {
    fail(`split APKs [${splits}] don't match the universal APK's ABIs [${abis}]`);
  }
  for (const abi of splits) {
    const inside = [...libAbis(apks.get(abi))].sort();
    if (inside.length !== 1 || inside[0] !== abi)
      fail(`app-${abi}-release.apk contains native libs for [${inside}]`);
  }

  for (const [abi, file] of apks)
    fs.renameSync(file, path.join(outDir, `${APP}-${label}-${abi}.apk`));
  fs.rmSync(raw, { recursive: true });
  fs.rmSync(archive);
  console.log(`  ${apks.size} APKs: ${splits.join(', ')} + universal`);
  writeChecksums({ outDir });
}

// Everything a release ships: what any build step left in outDir.
const assetFiles = (outDir) =>
  fs.existsSync(outDir)
    ? fs
        .readdirSync(outDir)
        .filter((f) => /\.(apk|aab|ipa)$/.test(f))
        .sort()
    : [];

function writeChecksums({ outDir }) {
  step('SHA256SUMS');
  const lines = assetFiles(outDir).map((f) => `${sha256(path.join(outDir, f))}  ${f}`);
  fs.writeFileSync(path.join(outDir, 'SHA256SUMS'), lines.join('\n') + '\n');
  console.log(lines.map((l) => `  ${l}`).join('\n'));
}

// null when the artifacts are there and match SHA256SUMS, otherwise what's wrong with them.
function artifactProblem({ outDir }) {
  const sums = path.join(outDir, 'SHA256SUMS');
  if (!fs.existsSync(sums)) return `${sums} missing — run \`build-android ${version}\` first`;
  const listed = fs
    .readFileSync(sums, 'utf8')
    .trim()
    .split('\n')
    .map((l) => l.split(/\s+/));
  const files = assetFiles(outDir);
  if (
    listed
      .map(([, f]) => f)
      .sort()
      .join() !== files.join()
  )
    return `SHA256SUMS does not match the files in ${outDir}`;
  for (const [hash, f] of listed)
    if (sha256(path.join(outDir, f)) !== hash) return `checksum mismatch for ${f}`;
  if (!files.some((f) => f.endsWith('-universal.apk'))) return 'universal APK missing';
  return null;
}

function artifactsVerified() {
  return artifactProblem(ctx) === null;
}

function verifyArtifacts() {
  step('Verify artifacts');
  const problem = artifactProblem(ctx);
  if (problem) fail(problem);
}

// `build`: the production split APKs of whatever is checked out, with no version change, commit
// or tag — to try a build, or to hand one over from GitHub Actions.
function standaloneBuild() {
  const commit = out('git', ['rev-parse', '--short', 'HEAD']);
  const dirty = changedFiles().length > 0 ? '-dirty' : '';
  const label = `v${readPkgVersion()}-${commit}${dirty}`;
  const outDir = path.join('releases', label);
  buildAndroid({ label, outDir });
  console.log(`\n✔ Built ${label}: ${outDir}/`);
}

// ---------- commit ----------

function commitRelease() {
  assertPrepared();
  verifyArtifacts();
  if (headSubject() !== releaseSubject) {
    step(`Release commit (${releaseSubject})`);
    const files = versionFiles().filter((f) => changedFiles().includes(f));
    if (files.length === 0) fail(`nothing to commit for ${version}`);
    run('git', ['add', ...files]);
    run('git', ['commit', '--quiet', '-m', releaseSubject]);
  }
  step('Tag');
  if (!localTagExists()) run('git', ['tag', '-a', tag, '-m', tag]);
  else if (!isCommitted()) fail(`tag ${tag} exists but isn't on the release commit`);
}

// ---------- publish ----------

function releaseNotes() {
  const body = changelogSection(fs.readFileSync('CHANGELOG.md', 'utf8'), version)?.[1].trim();
  if (!body) fail(`CHANGELOG.md has no [${version}] section to use as release notes`);
  const apk = (abi) => `\`${APP}-${tag}-${abi}.apk\``;
  const footer = [
    '',
    '---',
    `**Android:** most phones → ${apk('arm64-v8a')} · older 32-bit phones → ${apk('armeabi-v7a')} · not sure → ${apk('universal')} (x86/x86_64 are for emulators). \`SHA256SUMS\` to verify downloads.`,
  ].join('\n');
  const file = path.join(ctx.outDir, 'release-notes.md');
  fs.writeFileSync(file, body + '\n' + footer + '\n');
  return file;
}

function publishGitHub() {
  assertCleanMain();
  if (!isCommitted()) fail(`HEAD is not a tagged "${releaseSubject}" — run \`commit ${version}\``);
  verifyArtifacts();

  if (!canPublishToGitHub()) {
    console.log(
      `\n✔ Tagged ${tag}. No GitHub remote/auth found — APKs stay local at ${ctx.outDir}/.`,
    );
    return;
  }
  assertReleaser();

  step('Push');
  run('git', ['fetch', '--quiet', 'origin']);
  if (!succeeds('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD']))
    fail('origin/main has moved on — not a fast-forward');
  run('git', ['push', '--atomic', 'origin', 'main', `refs/tags/${tag}`]);

  step('GitHub release (draft → published)');
  const assets = [...assetFiles(ctx.outDir), 'SHA256SUMS'].map((f) => path.join(ctx.outDir, f));
  const notes = releaseNotes();
  if (succeeds('gh', ['release', 'view', tag])) {
    // Re-run after a failed upload: refresh the draft's assets and notes.
    run('gh', ['release', 'upload', tag, ...assets, '--clobber']);
    run('gh', ['release', 'edit', tag, '--notes-file', notes]);
  } else {
    run('gh', [
      'release',
      'create',
      tag,
      ...assets,
      '--draft',
      '--verify-tag',
      '--title',
      tag,
      '--notes-file',
      notes,
    ]);
  }
  run('gh', ['release', 'edit', tag, '--draft=false', '--latest']);
  console.log(
    `\n✔ Released ${tag}: ${out('gh', ['release', 'view', tag, '--json', 'url', '-q', '.url'])}`,
  );
}

// ---------- abort ----------

function abort() {
  assertOnMain();
  if (headSubject() === releaseSubject) {
    if (hasRemote()) {
      run('git', ['fetch', '--quiet', 'origin']);
      if (succeeds('git', ['merge-base', '--is-ancestor', 'HEAD', 'origin/main']))
        fail('the release commit is already on origin/main — too late to abort');
      if (out('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]) !== '')
        fail(`tag ${tag} is already on origin — too late to abort`);
    }
    if (localTagExists()) run('git', ['tag', '-d', tag]);
    run('git', ['reset', '--keep', 'HEAD~1']);
    console.log(`\n✔ Dropped the unpushed "${releaseSubject}" commit.`);
  } else if (isPrepared()) {
    const files = versionFiles().filter((f) => changedFiles().includes(f));
    if (files.length > 0) run('git', ['checkout', 'HEAD', '--', ...files]);
    console.log(`\n✔ Restored ${files.join(', ')} — nothing had been committed for ${version}.`);
  } else {
    fail(`neither HEAD nor the working tree holds release ${version} — nothing to abort`);
  }
  fs.rmSync(ctx.outDir, { recursive: true, force: true });
}

// ---------- main ----------

function runStep(name, { explicit }) {
  const s = STEPS[name];
  if (s.done?.() && !(explicit && s.rerunnable)) {
    console.log(`\n✔ ${name}: already done for ${version}`);
    return;
  }
  s.run(ctx);
}

if (command === 'build') {
  standaloneBuild();
} else if (command === 'abort') {
  abort();
} else if (command === 'release') {
  for (const name of RELEASE) {
    runStep(name, { explicit: false });
    if (pause && name === PAUSE_AFTER) {
      console.log(`\n⏸ Paused before committing. Artifacts are in ${ctx.outDir}/.`);
      console.log(`  Try the APKs on a phone, then:  npm run release -- ${version}`);
      console.log(`  Or to drop this release:        npm run release -- abort ${version}`);
      break;
    }
  }
} else {
  runStep(command, { explicit: true });
}
