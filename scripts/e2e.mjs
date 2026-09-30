#!/usr/bin/env node
// Runs the device checklist (.maestro/) against a USB-connected phone and the throwaway Firefly
// III from scripts/ff3-test.mjs. `npm run e2e -- --help` for usage.
//
// A checklist flow is one or more Maestro files plus host steps between them — sharing a photo
// into the app, running the background job, Firefly III's cron, toggling Wi-Fi or dark mode,
// installing an APK — things a Maestro flow can't do from the phone. FLOWS below is the list, in
// run order, with the files each one covers (`--changed`), mirroring the device-run checklist.
//
// Every run starts from the seed snapshot and a cleared app, so flows can rely on the seed and
// each flow makes its own data, named with the run's RUN_ID.

import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MAESTRO_DIR = path.join(ROOT, '.maestro');
const FLOW_DIR = path.join(MAESTRO_DIR, 'flows');
const FIXTURES = path.join(MAESTRO_DIR, 'fixtures');
const FF3_SCRIPT = path.join(MAESTRO_DIR, 'scripts', 'ff3.js');

// ---------- the checklist ----------

const share = (fixture) => ({ host: 'share', fixture });
const host = (name, extra = {}) => ({ host: name, ...extra });

/**
 * id/title as in the device-run checklist. steps: Maestro files (relative to .maestro/flows) and
 * host steps; `always` host steps run even after a failed step (they restore the phone). requires:
 * reader (GEMINI_KEY or LOCAL_MODEL_URL), lan (--lan), second (--second-instance), apks
 * (--apk and --previous-apk). areas: path prefixes that make `--changed` pick the flow.
 */
export const FLOWS = [
  {
    id: 'S1',
    tier: 'smoke',
    title: 'Cold start',
    steps: ['smoke/S1-cold-start.yaml'],
    areas: ['src/db/', 'src/providers/', 'app/_layout.tsx'],
  },
  {
    id: 'S2',
    tier: 'smoke',
    title: 'Capture a withdrawal',
    steps: ['smoke/S2-capture-withdrawal.yaml'],
    areas: ['app/capture.tsx', 'src/capture/', 'src/ui/Keypad.tsx'],
  },
  {
    id: 'S3',
    tier: 'smoke',
    title: 'Confirm, then Undo',
    steps: ['smoke/S3-confirm-undo.yaml'],
    areas: ['src/inbox/', 'src/ui/Snackbar.tsx'],
  },
  {
    id: 'S4',
    tier: 'smoke',
    title: 'Edit a synced transaction',
    steps: ['smoke/S4-edit-synced.yaml'],
    areas: ['app/transactions/', 'src/transactions/'],
  },
  {
    id: 'S5',
    tier: 'smoke',
    title: 'Delete from Activity',
    steps: ['smoke/S5-delete.yaml'],
    areas: ['app/(tabs)/activity.tsx'],
  },
  {
    id: 'S6',
    tier: 'smoke',
    title: 'Offline round trip',
    steps: ['smoke/S6-offline-round-trip.yaml'],
    areas: ['src/sync/'],
  },

  {
    id: 'C1',
    tier: 'release',
    title: 'Deposit and transfer',
    steps: ['capture/C1-deposit-transfer.yaml'],
    areas: ['app/capture.tsx', 'src/capture/', 'src/inbox/'],
  },
  {
    id: 'C2',
    tier: 'release',
    title: 'Foreign currency',
    steps: ['capture/C2-foreign-currency.yaml'],
    areas: ['app/capture.tsx', 'src/capture/', 'src/inbox/', 'src/api/ff3/decimal.ts'],
  },
  {
    id: 'C3',
    tier: 'release',
    title: 'Split transaction',
    steps: ['capture/C3-split.yaml'],
    areas: [
      'app/draft/',
      'src/splits/',
      'src/inbox/',
      'src/ui/AllocationSheet.tsx',
      'src/ui/SplitPager.tsx',
      'src/ui/SplitPage.tsx',
    ],
  },
  {
    id: 'C4',
    tier: 'release',
    title: 'Payee alias is learned',
    steps: ['capture/C4-payee-alias.yaml'],
    areas: ['app/draft/', 'src/lookup/', 'src/inbox/', 'app/settings/aliases.tsx'],
  },
  {
    id: 'C5',
    tier: 'release',
    title: 'Typing in a draft',
    steps: ['capture/C5-draft-typing.yaml'],
    areas: ['app/draft/', 'src/ui/TextField.tsx', 'src/inbox/'],
  },
  {
    id: 'C6',
    tier: 'release',
    title: 'Confirm all, then Undo',
    steps: ['capture/C6-confirm-all-undo.yaml'],
    areas: ['app/(tabs)/index.tsx', 'src/inbox/', 'src/ui/InboxCards.tsx'],
  },

  {
    id: 'R2',
    tier: 'release',
    title: 'Share from the gallery',
    steps: [
      share('receipt-r2.jpg'),
      'receipts/R2-share-twice.a.yaml',
      share('receipt-r2.jpg'),
      'receipts/R2-share-twice.b.yaml',
    ],
    areas: ['src/receipt/', 'app/receipt.tsx'],
  },
  {
    id: 'R3',
    tier: 'release',
    title: 'No reader available',
    steps: [share('receipt-r3.jpg'), 'receipts/R3-no-reader.yaml'],
    areas: ['src/receipt/'],
  },
  {
    id: 'R1',
    tier: 'release',
    title: 'Read a receipt',
    requires: ['reader'],
    steps: [
      'receipts/R1-read-receipt.a.yaml',
      share('receipt-r1.jpg'),
      'receipts/R1-read-receipt.b.yaml',
    ],
    areas: ['src/receipt/', 'app/receipt.tsx'],
  },

  {
    id: 'Q1',
    tier: 'release',
    title: 'Conflict: keep mine / use server’s',
    steps: ['sync/Q1-conflict.yaml'],
    areas: ['src/sync/', 'src/transactions/', 'src/ui/ConflictView.tsx'],
  },
  {
    id: 'Q2',
    tier: 'release',
    title: 'One failure doesn’t hold the rest',
    steps: ['sync/Q2-failure-holds-only-its-own.yaml'],
    areas: ['src/sync/', 'src/api/ff3/'],
  },
  {
    id: 'Q3',
    tier: 'release',
    title: 'Retry now, Discard, Cancel',
    steps: ['sync/Q3-retry-discard-cancel.yaml'],
    areas: ['src/sync/', 'src/inbox/', 'src/ui/InboxCards.tsx'],
  },
  {
    id: 'Q4',
    tier: 'release',
    title: 'Network drops mid-sync',
    steps: ['sync/Q4-network-drops-mid-sync.yaml'],
    areas: ['src/sync/', 'src/api/ff3/'],
  },
  {
    id: 'Q5',
    tier: 'release',
    title: 'Background sync',
    steps: [
      'sync/Q5-background-sync.a.yaml',
      host('backgroundJob'),
      'sync/Q5-background-sync.b.yaml',
    ],
    areas: ['src/sync/'],
  },

  {
    id: 'A1',
    tier: 'release',
    title: 'Search and filters',
    steps: ['activity/A1-search-filters.yaml'],
    areas: ['app/(tabs)/activity.tsx', 'src/transactions/', 'src/lookup/normkey.ts'],
  },
  {
    id: 'A2',
    tier: 'release',
    title: 'Older history',
    steps: ['activity/A2-older-history.yaml'],
    areas: ['app/(tabs)/activity.tsx', 'src/transactions/', 'src/sync/referenceData.ts'],
  },
  {
    id: 'A3',
    tier: 'release',
    title: 'Split detail and duplicate',
    steps: ['activity/A3-split-detail-duplicate.yaml'],
    areas: ['app/transactions/', 'src/transactions/', 'src/splits/'],
  },

  {
    id: 'P1',
    tier: 'release',
    title: 'Planned: create, reschedule, delete',
    steps: ['planned/P1-create-reschedule-delete.yaml'],
    areas: ['src/planned/', 'app/planned/', 'app/(tabs)/planned.tsx'],
  },
  {
    id: 'P2',
    tier: 'release',
    title: 'Recurring review',
    steps: [
      'planned/P2-recurring-review.a.yaml',
      host('cron'),
      'planned/P2-recurring-review.b.yaml',
    ],
    areas: ['src/sync/recurringReview.ts', 'src/ui/ReviewEditSheet.tsx', 'src/planned/'],
  },

  {
    id: 'K1',
    tier: 'release',
    title: 'Count cash',
    steps: ['count/K1-count-cash.yaml'],
    areas: ['src/reconcile/', 'app/count.tsx'],
  },

  {
    id: 'T1',
    tier: 'release',
    title: 'Account edits stick',
    steps: ['settings/T1-account-edits.yaml'],
    areas: [
      'src/accounts/',
      'app/accounts/',
      'app/settings/accounts.tsx',
      'src/sync/referenceHygiene.ts',
    ],
  },
  {
    id: 'T2',
    tier: 'release',
    title: 'Two server addresses',
    requires: ['lan'],
    steps: [
      'settings/T2-two-addresses.a.yaml',
      host('wifi', { on: false }),
      'settings/T2-two-addresses.b.yaml',
      host('wifi', { on: true, always: true }),
      'settings/T2-two-addresses.c.yaml',
    ],
    areas: [
      'src/api/ff3/hosts.ts',
      'src/api/ff3/session.ts',
      'src/sync/reachability.ts',
      'src/ui/AddressesSheet.tsx',
    ],
  },
  {
    id: 'T3',
    tier: 'release',
    title: 'Sign out and back in',
    steps: ['settings/T3-sign-out.yaml'],
    areas: ['app/(tabs)/settings.tsx', 'src/sync/instanceData.ts', 'src/api/ff3/auth.ts'],
  },
  {
    id: 'T3b',
    tier: 'release',
    title: 'Switch to another Firefly III',
    requires: ['second'],
    steps: ['settings/T3b-switch-instance.yaml'],
    areas: ['src/sync/instanceData.ts', 'app/(tabs)/settings.tsx'],
  },
  {
    id: 'T4',
    tier: 'release',
    title: 'Language and theme',
    steps: [
      'settings/T4-language-theme.a.yaml',
      host('night', { on: true }),
      'settings/T4-language-theme.b.yaml',
      host('night', { on: false, always: true }),
    ],
    areas: ['src/i18n/', 'src/ui/theme.ts', 'src/ui/'],
  },
  {
    id: 'T5',
    tier: 'release',
    title: 'Diagnostics log',
    steps: ['settings/T5-diagnostics.yaml', host('logSecrets')],
    areas: ['src/utils/log.ts', 'app/settings/logs.tsx'],
  },

  {
    id: 'U1',
    tier: 'release',
    title: 'Install over the previous release',
    requires: ['apks'],
    steps: [
      host('install', { which: 'previous' }),
      'upgrade/U1-install-over-previous.a.yaml',
      host('install', { which: 'current' }),
      'upgrade/U1-install-over-previous.b.yaml',
    ],
    areas: ['src/db/'],
  },
];

/** The flows `--changed` picks for a list of changed files: the smoke, plus every flow whose area matches. */
export function flowsForChanges(files) {
  const picked = new Set(FLOWS.filter((f) => f.tier === 'smoke').map((f) => f.id));
  for (const flow of FLOWS) {
    if (files.some((file) => flow.areas.some((area) => file.startsWith(area)))) picked.add(flow.id);
  }
  return FLOWS.filter((f) => picked.has(f.id));
}

export function selectFlows(args) {
  const ids = args.filter((a) => !['smoke', 'release', 'all'].includes(a));
  if (args.length === 0 || args.includes('smoke')) return FLOWS.filter((f) => f.tier === 'smoke');
  if (args.includes('release') || args.includes('all')) return FLOWS;
  const unknown = ids.filter((id) => !FLOWS.some((f) => f.id.toLowerCase() === id.toLowerCase()));
  if (unknown.length) throw new Error(`unknown flow(s): ${unknown.join(', ')} — see --list`);
  return FLOWS.filter((f) => ids.some((id) => id.toLowerCase() === f.id.toLowerCase()));
}

// ---------- helpers ----------

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}
const say = (message) => console.log(`▶ ${message}`);

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      opts._.push(arg);
      continue;
    }
    const [key, inline] = arg.slice(2).split('=', 2);
    if (inline !== undefined) opts[key] = inline;
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') && !BOOLEAN.has(key))
      opts[key] = argv[++i];
    else opts[key] = true;
  }
  return opts;
}
const BOOLEAN = new Set([
  'list',
  'plan',
  'lan',
  'second-instance',
  'no-reset',
  'keep-app-data',
  'reinstall',
  'manual-share',
  'help',
  'json',
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function maestroBin() {
  const onPath = spawnSync('maestro', ['--version'], { stdio: 'ignore' });
  if (!onPath.error) return 'maestro';
  const home = path.join(os.homedir(), '.maestro', 'bin', 'maestro');
  if (fs.existsSync(home)) return home;
  fail('Maestro is not installed: curl -Ls "https://get.maestro.mobile.dev" | bash');
}

let DEVICE = null;
function adb(args, { allowFail = false, capture = true } = {}) {
  const r = spawnSync('adb', [...(DEVICE ? ['-s', DEVICE] : []), ...args], {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (r.error) fail(`adb is not available: ${r.error.message}`);
  if (r.status !== 0 && !allowFail)
    throw new Error(`adb ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  return (r.stdout ?? '').trim();
}

/**
 * Uninstalls and reinstalls the app — the way to start with empty app data on a phone that
 * refuses `pm clear`. Installs `apk` when given; otherwise pulls the installed APK (and any splits)
 * off the phone first, so it goes back exactly as it was.
 */
function reinstallApp(appId, apk) {
  let files = apk ? [apk] : null;
  if (!files) {
    const remote = adb(['shell', 'pm', 'path', appId])
      .split('\n')
      .map((l) => l.trim().replace(/^package:/, ''))
      .filter(Boolean);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmyway-apk-'));
    files = remote.map((p, i) => {
      const local = path.join(dir, `${i}-${path.basename(p)}`);
      adb(['pull', p, local]);
      return local;
    });
  }
  adb(['uninstall', appId], { allowFail: true });
  try {
    adb([files.length > 1 ? 'install-multiple' : 'install', ...files]);
  } catch (err) {
    fail(
      `${err.message}\n${appId} is uninstalled now — install it again with: adb install${files.length > 1 ? '-multiple' : ''} ${files.join(' ')}`,
    );
  }
}

/**
 * Whether the phone routes the sign-in link (.maestro/subflows/sign-in.yaml) to the installed app.
 * Only a Dev build from a checkout with app/e2e-sign-in.tsx registers its scheme; on an older
 * build the flows would wait out a 45 s timeout for "Connected to Firefly III" instead.
 */
function answersSignInLink() {
  const out = adb(
    [
      'shell',
      'cmd',
      'package',
      'resolve-activity',
      '--brief',
      '-a',
      'android.intent.action.VIEW',
      '-d',
      'mmyway-dev://e2e-sign-in',
    ],
    { allowFail: true },
  );
  return !/no activity found/i.test(out);
}

const NO_SIGN_IN_LINK = (what) =>
  `${what} doesn't answer the sign-in link (mmyway-dev://e2e-sign-in), so the flows can't sign in: it is older than app/e2e-sign-in.tsx, or it isn't the Dev build. Build the Dev build again (npm run android:build:dev) and pass it with --apk.`;

function ff3Test(args) {
  return execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'ff3-test.mjs'), ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

function ff3Env(name) {
  return JSON.parse(ff3Test(['env', '--format', 'json', '--name', name]));
}

async function healthy(url) {
  try {
    return (await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) })).status === 200;
  } catch {
    return false;
  }
}

function changedFiles(base) {
  const ref = base === true ? 'origin/main' : base;
  const out = new Set();
  for (const args of [
    ['diff', '--name-only', `${ref}...HEAD`],
    ['diff', '--name-only', 'HEAD'],
    ['ls-files', '--others', '--exclude-standard'],
  ]) {
    try {
      execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })
        .split('\n')
        .filter(Boolean)
        .forEach((f) => out.add(f));
    } catch {
      // a missing base ref: the working tree alone
    }
  }
  return [...out];
}

// ---------- host steps ----------

const HOST_STEPS = {
  async share(step, ctx) {
    const src = path.join(FIXTURES, step.fixture);
    const name = `${ctx.runId}-${step.fixture}`;
    const dir = '/sdcard/Pictures/mmyway-test';
    if (ctx.opts['manual-share']) {
      console.log(
        `\n  Share ${src} into ${ctx.appId} now (Gallery → Share → mmyway), then press Enter.`,
      );
      await new Promise((resolve) => process.stdin.once('data', resolve));
      return;
    }
    adb(['shell', 'mkdir', '-p', dir]);
    adb(['push', src, `${dir}/${name}`]);
    adb(
      [
        'shell',
        'am',
        'broadcast',
        '-a',
        'android.intent.action.MEDIA_SCANNER_SCAN_FILE',
        '-d',
        `file://${dir}/${name}`,
      ],
      { allowFail: true },
    );
    let id = null;
    for (let i = 0; i < 20 && !id; i++) {
      const rows = adb(
        [
          'shell',
          'content',
          'query',
          '--uri',
          'content://media/external/images/media',
          '--projection',
          '_id',
          '--where',
          `"_display_name='${name}'"`,
        ],
        { allowFail: true },
      );
      id = /_id=(\d+)/.exec(rows)?.[1] ?? null;
      if (!id) {
        if (i === 3)
          adb(
            [
              'shell',
              'content',
              'call',
              '--uri',
              'content://media',
              '--method',
              'scan_volume',
              '--arg',
              'external_primary',
            ],
            { allowFail: true },
          );
        await sleep(500);
      }
    }
    if (!id) throw new Error(`the photo didn't show up in MediaStore — rerun with --manual-share`);
    adb([
      'shell',
      'am',
      'start',
      '-a',
      'android.intent.action.SEND',
      '-t',
      'image/jpeg',
      '--eu',
      'android.intent.extra.STREAM',
      `content://media/external/images/media/${id}`,
      '--grant-read-uri-permission',
      '-p',
      ctx.appId,
    ]);
    await sleep(3000);
  },

  async backgroundJob(_step, ctx) {
    // Only the background task may send it: the app's process is gone, the network comes back,
    // and the WorkManager job is run on demand instead of in ~15 minutes.
    adb(['shell', 'am', 'kill', ctx.appId], { allowFail: true });
    adb(['shell', 'cmd', 'connectivity', 'airplane-mode', 'disable'], { allowFail: true });
    await sleep(5000);
    const jobs = adb(['shell', 'dumpsys', 'jobscheduler'], { allowFail: true });
    const ids = [
      ...jobs.matchAll(
        new RegExp(`JOB #u\\d+a?\\d*/(\\d+): \\S+ ${ctx.appId.replaceAll('.', '\\.')}/`, 'g'),
      ),
    ].map((m) => m[1]);
    if (ids.length === 0)
      throw new Error(
        `no scheduled job for ${ctx.appId} — was background sync registered? (dumpsys jobscheduler)`,
      );
    for (const id of new Set(ids))
      adb(['shell', 'cmd', 'jobscheduler', 'run', '-f', ctx.appId, id], { allowFail: true });
  },

  async cron(_step, ctx) {
    ff3Test(['cron', '--name', ctx.opts.name ?? 'default']);
  },

  async wifi(step) {
    adb(['shell', 'svc', 'wifi', step.on ? 'enable' : 'disable'], { allowFail: true });
    await sleep(step.on ? 8000 : 3000);
  },

  async night(step) {
    adb(['shell', 'cmd', 'uimode', 'night', step.on ? 'yes' : 'no'], { allowFail: true });
    await sleep(2000);
  },

  async logSecrets(_step, ctx) {
    const r = spawnSync(
      'adb',
      [...(DEVICE ? ['-s', DEVICE] : []), 'shell', 'run-as', ctx.appId, 'cat', 'files/mmyway.log'],
      { encoding: 'utf8' },
    );
    if (r.status !== 0) {
      ctx.notes.push(
        'T5: the log could not be read over adb (not a debuggable build) — check it for secrets by hand.',
      );
      return;
    }
    // The run's own credentials, read from env at run time — no value is in this file.
    const watched = [ctx.env.FF3_TOKEN, ctx.env.GEMINI_KEY].filter((v) => v && v.length > 8); // ggignore
    const leaked = watched.filter((v) => r.stdout.includes(v.slice(0, 24)));
    if (leaked.length || /Bearer [A-Za-z0-9._-]{20,}/.test(r.stdout))
      throw new Error('the Diagnostics log contains an API token or key');
  },

  async install(step, ctx) {
    const apk = step.which === 'previous' ? ctx.opts['previous-apk'] : ctx.opts.apk;
    if (step.which === 'previous') adb(['uninstall', ctx.appId], { allowFail: true });
    adb(['install', '-r', apk], { capture: false });
    if (!answersSignInLink())
      throw new Error(
        NO_SIGN_IN_LINK(
          step.which === 'previous'
            ? `--previous-apk (${path.basename(apk)})`
            : `--apk (${path.basename(apk)})`,
        ),
      );
  },
};

// ---------- the Node stand-in for Maestro's script engine (selftest) ----------

/** Runs .maestro/scripts/ff3.js the way Maestro does: synchronous `http`, env as globals, `output`. */
export function runFf3Script(env) {
  const output = {};
  const http = {
    request(url, options = {}) {
      const args = ['-s', '-o', '-', '-w', '\n%{http_code}', '-X', options.method ?? 'GET', url];
      for (const [k, v] of Object.entries(options.headers ?? {})) args.push('-H', `${k}: ${v}`);
      if (options.body !== undefined) args.push('--data-binary', options.body);
      const raw = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      const cut = raw.lastIndexOf('\n');
      return { status: Number(raw.slice(cut + 1)), body: raw.slice(0, cut) };
    },
  };
  vm.runInNewContext(
    fs.readFileSync(FF3_SCRIPT, 'utf8'),
    { http, output, Date, JSON, Number, String, Error, Object, ...env },
    { filename: FF3_SCRIPT },
  );
  return output;
}

async function selftest(opts) {
  const name = opts.name ?? 'default';
  const env = ff3Env(name);
  if (!(await healthy(env.FF3_URL)))
    fail(
      `the test instance isn't running — npm run ff3:test -- up${name === 'default' ? '' : ` --name ${name}`}`,
    );
  const base = { FF3_URL: env.FF3_URL, FF3_TOKEN: env.FF3_TOKEN, TIMEOUT_MS: '8000' };
  const id = crypto.randomBytes(3).toString('hex');
  const checks = [
    ['ping', { ACTION: 'ping' }],
    [
      'createTx',
      {
        ACTION: 'createTx',
        PAYEE: `self ${id}`,
        DESCRIPTION: `self ${id}`,
        AMOUNT: '12.34',
        CATEGORY: 'Groceries',
      },
    ],
    [
      'findTx',
      {
        ACTION: 'findTx',
        PAYEE: `self ${id}`,
        EXPECT_AMOUNT: '12.34',
        EXPECT_CATEGORY: 'Groceries',
        EXPECT_SOURCE: 'Checking',
      },
    ],
    ['findTx AMOUNT_IS', { ACTION: 'findTx', AMOUNT_IS: '12.34', DESCRIPTION: `self ${id}` }],
    [
      'updateTx',
      { ACTION: 'updateTx', PAYEE: `self ${id}`, NEW_AMOUNT: '99.00', NEW_CATEGORY: 'Fuel' },
    ],
    [
      'findTx after update',
      { ACTION: 'findTx', PAYEE: `self ${id}`, EXPECT_AMOUNT: '99', EXPECT_CATEGORY: 'Fuel' },
    ],
    [
      'findTx wrong amount fails',
      { ACTION: 'findTx', PAYEE: `self ${id}`, EXPECT_AMOUNT: '1', TIMEOUT_MS: '1000' },
      'fails',
    ],
    ['deleteTx', { ACTION: 'deleteTx', PAYEE: `self ${id}` }],
    ['expectNoTx', { ACTION: 'expectNoTx', PAYEE: `self ${id}` }],
    [
      'findTx split seed',
      { ACTION: 'findTx', DESCRIPTION: 'Weekly shop', EXPECT_SPLITS: '2', EXPECT_TOTAL: '52.50' },
    ],
    [
      'createRecurrence',
      {
        ACTION: 'createRecurrence',
        TITLE: `self ${id}`,
        AMOUNT: '9.99',
        FOREIGN_AMOUNT: '2.30',
        FOREIGN_CURRENCY: 'EUR',
      },
    ],
    [
      'expectPlanned',
      {
        ACTION: 'expectPlanned',
        NAME: `self ${id}`,
        EXPECT_BILLS: '0',
        EXPECT_RECURRENCES: '1',
        EXPECT_RULES: '0',
      },
    ],
    ['balance', { ACTION: 'balance', NAME: 'Cash wallet' }],
    [
      'expectAccount',
      {
        ACTION: 'expectAccount',
        NAME: 'Cash wallet',
        EXPECT_ACTIVE: 'true',
        EXPECT_NOTES_CONTAINS: 'mmyway-envelope',
      },
    ],
    [
      'updateAccount',
      {
        ACTION: 'updateAccount',
        NAME: 'Savings EUR',
        NEW_NAME: `Savings EUR ${id}`,
        ACTIVE: 'false',
      },
    ],
    [
      'expectAccount renamed',
      { ACTION: 'expectAccount', NAME: `Savings EUR ${id}`, EXPECT_ACTIVE: 'false' },
    ],
    [
      'updateAccount back',
      {
        ACTION: 'updateAccount',
        NAME: `Savings EUR ${id}`,
        NEW_NAME: 'Savings EUR',
        ACTIVE: 'true',
        NOTES: '-',
      },
    ],
  ];
  let failed = 0;
  for (const [label, env2, expect] of checks) {
    let error = null;
    let out = {};
    try {
      out = runFf3Script({ ...base, ...env2 });
    } catch (err) {
      error = err;
    }
    const ok = expect === 'fails' ? !!error : !error;
    if (!ok) failed++;
    console.log(
      `${ok ? '✔' : '✖'} ${label}${error && expect !== 'fails' ? `: ${error.message}` : ''}${Object.keys(out).length ? ` ${JSON.stringify(out)}` : ''}`,
    );
  }
  // The recurrence was only for the check; the next reset removes it anyway.
  console.log(
    failed ? `\n${failed} check(s) failed` : '\nall ff3.js actions work against the test instance',
  );
  if (failed) process.exit(1);
  console.log('Run `npm run ff3:test -- reset` to drop what the self-test created.');
}

// ---------- the run ----------

function requirementsMissing(flow, ctx) {
  const missing = [];
  for (const r of flow.requires ?? []) {
    if (r === 'reader' && !ctx.env.GEMINI_KEY && !ctx.env.LOCAL_MODEL_URL)
      missing.push('a receipt reader (--gemini-key or --local-model-url + --local-model-name)');
    if (r === 'lan' && (!ctx.opts.lan || !ctx.env.FF3_LAN_URL))
      missing.push('--lan (phone on the same Wi-Fi as this computer)');
    if (r === 'second' && !ctx.opts['second-instance']) missing.push('--second-instance');
    if (r === 'apks' && !(ctx.opts.apk && ctx.opts['previous-apk']))
      missing.push('--apk and --previous-apk');
  }
  return missing;
}

export function reportMarkdown(
  results,
  { build, tier, date = new Date().toISOString().slice(0, 10) },
) {
  const count = (s) => results.filter((r) => r.status === s).length;
  const lines = [
    `### Device run · ${build || 'unnamed build'} · ${date}`,
    `${tier}: ${count('pass')} passed, ${count('fail')} failed, ${count('skip')} skipped (automated with Maestro)`,
    '',
  ];
  for (const r of results) {
    const mark =
      r.status === 'pass' ? '- [x] ' : r.status === 'fail' ? '- [ ] **FAIL** ' : '- [ ] skipped: ';
    lines.push(`${mark}${r.id} ${r.title}${r.detail ? ` — ${r.detail}` : ''}`);
  }
  return lines.join('\n') + '\n';
}

async function run(opts) {
  let flows;
  try {
    flows =
      opts.changed !== undefined
        ? flowsForChanges(changedFiles(opts.changed))
        : selectFlows(opts._);
  } catch (err) {
    fail(err.message);
  }
  const tier =
    opts.changed !== undefined
      ? 'Changed areas'
      : opts._.includes('release') || opts._.includes('all')
        ? 'Before a release'
        : opts._.length === 0 || opts._.includes('smoke')
          ? 'Every build'
          : 'Selected flows';

  if (opts.list || opts.plan) {
    if (opts.json)
      return console.log(
        JSON.stringify(
          flows.map((f) => ({
            id: f.id,
            title: f.title,
            steps: f.steps,
            requires: f.requires ?? [],
          })),
          null,
          2,
        ),
      );
    for (const f of flows)
      console.log(
        `${f.id.padEnd(4)} ${f.title}${f.requires ? `  (needs ${f.requires.join(', ')})` : ''}`,
      );
    return;
  }

  const appId = opts['app-id'] ?? process.env.APP_ID ?? 'com.mkloouo.mmyway.dev';
  const instance = opts.name ?? 'default';
  const maestro = maestroBin();

  // Preflight: one phone, the app, the test instance.
  const devices = spawnSync('adb', ['devices'], { encoding: 'utf8' });
  if (devices.error) fail('adb is not installed (Android platform-tools)');
  const serials = devices.stdout
    .split('\n')
    .slice(1)
    .map((l) => l.split('\t'))
    .filter(([s, state]) => s && state === 'device')
    .map(([s]) => s);
  DEVICE = opts.device ?? (serials.length === 1 ? serials[0] : null);
  if (!DEVICE)
    fail(
      serials.length
        ? `several devices — pick one with --device (${serials.join(', ')})`
        : 'no phone connected with USB debugging on',
    );

  const ff3 = ff3Env(instance);
  if (!(await healthy(ff3.FF3_URL)))
    fail(
      `the test Firefly III isn't running — npm run ff3:test -- ${instance === 'default' ? 'up' : `up --name ${instance}`} (or fresh)`,
    );
  if (!opts['no-reset']) {
    say('resetting the test Firefly III to its seed');
    ff3Test(['reset', '--name', instance]);
  }
  const port = new URL(ff3.FF3_URL).port;
  adb(['reverse', `tcp:${port}`, `tcp:${port}`]);

  const env = {
    APP_ID: appId,
    RUN_ID: Date.now().toString(36).slice(-6),
    FF3_URL: ff3.FF3_URL,
    FF3_TOKEN: ff3.FF3_TOKEN,
    FF3_LAN_URL: ff3.FF3_LAN_URL,
    FF3_B_URL: '',
    FF3_B_TOKEN: '',
    GEMINI_KEY: opts['gemini-key'] ?? process.env.GEMINI_KEY ?? '',
    LOCAL_MODEL_URL: opts['local-model-url'] ?? process.env.LOCAL_MODEL_URL ?? '',
    LOCAL_MODEL_NAME: opts['local-model-name'] ?? process.env.LOCAL_MODEL_NAME ?? '',
  };
  if (opts['second-instance'] && flows.some((f) => f.requires?.includes('second'))) {
    say('preparing the second instance for T3b');
    try {
      ff3Test(['reset', '--name', 'second']);
    } catch {
      ff3Test(['fresh', '--name', 'second', '--port', String(Number(port) + 1)]);
    }
    const b = ff3Env('second');
    const bPort = new URL(b.FF3_URL).port;
    adb(['reverse', `tcp:${bPort}`, `tcp:${bPort}`]);
    env.FF3_B_URL = b.FF3_URL;
    env.FF3_B_TOKEN = b.FF3_TOKEN;
  }

  const reinstall = opts.reinstall && !opts['keep-app-data'];
  if (opts.apk && !flows.some((f) => f.id === 'U1') && !reinstall) {
    say(`installing ${opts.apk}`);
    adb(['install', '-r', opts.apk], { capture: false });
  }
  if (!adb(['shell', 'pm', 'path', appId], { allowFail: true }) && !(reinstall && opts.apk))
    fail(`${appId} isn't installed on the phone — pass --apk, or --app-id for another variant`);
  if (reinstall) {
    say('reinstalling the app, so the run starts signed out with an empty database');
    reinstallApp(appId, opts.apk);
  } else if (!opts['keep-app-data']) {
    say('clearing the app, so the run starts signed out with an empty database');
    try {
      adb(['shell', 'pm', 'clear', appId]);
    } catch (err) {
      if (!/CLEAR_APP_USER_DATA|SecurityException/.test(err.message)) throw err;
      fail(
        `this phone doesn't let adb clear an app's data (some vendors restrict it on user builds;
on Xiaomi, turning on "USB debugging (Security settings)" allows it). Rerun with --reinstall to
uninstall and reinstall the app instead.`,
      );
    }
  }

  // U1 installs its own builds (and checks them); every other flow signs in through the link.
  if (!flows.every((f) => f.id === 'U1') && !answersSignInLink()) fail(NO_SIGN_IN_LINK(appId));

  const outDir = path.join(
    ROOT,
    'e2e-results',
    `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${env.RUN_ID}`,
  );
  fs.mkdirSync(outDir, { recursive: true });
  const ctx = { opts, appId, env, runId: env.RUN_ID, notes: [] };
  const results = [];
  const started = Date.now();

  for (const flow of flows) {
    const missing = requirementsMissing(flow, ctx);
    if (missing.length) {
      results.push({
        id: flow.id,
        title: flow.title,
        status: 'skip',
        detail: `needs ${missing.join('; ')}`,
      });
      console.log(`⏭  ${flow.id} ${flow.title} — needs ${missing.join('; ')}`);
      continue;
    }
    process.stdout.write(`▶ ${flow.id} ${flow.title} … `);
    const t0 = Date.now();
    let failure = null;
    for (const [i, step] of flow.steps.entries()) {
      if (failure && !(step.host && step.always)) continue;
      try {
        if (typeof step === 'string') {
          const args = [
            '--device',
            DEVICE,
            'test',
            path.join(FLOW_DIR, step),
            '--format',
            'junit',
            '--output',
            path.join(outDir, `${flow.id}-${i}.xml`),
            '--test-output-dir',
            path.join(outDir, flow.id),
          ];
          for (const [k, v] of Object.entries(env)) args.push('-e', `${k}=${v}`);
          const r = spawnSync(maestro, args, { encoding: 'utf8' });
          fs.appendFileSync(
            path.join(outDir, `${flow.id}.log`),
            `$ maestro test ${step}\n${r.stdout}\n${r.stderr}\n`,
          );
          if (r.status !== 0) {
            const why = (r.stdout + r.stderr)
              .split('\n')
              .reverse()
              .find((l) => /fail|error|not found|assert/i.test(l) && !/JAVA_TOOL_OPTIONS/.test(l));
            throw new Error(`${path.basename(step)}: ${why?.trim() ?? `exit ${r.status}`}`);
          }
        } else {
          await HOST_STEPS[step.host](step, ctx);
        }
      } catch (err) {
        failure ??= err;
      }
    }
    // Whatever happened, give the next flow a phone with network and a light theme.
    adb(['shell', 'cmd', 'connectivity', 'airplane-mode', 'disable'], { allowFail: true });
    const seconds = Math.round((Date.now() - t0) / 1000);
    if (failure) {
      results.push({ id: flow.id, title: flow.title, status: 'fail', detail: failure.message });
      console.log(
        `✖ ${seconds} s\n   ${failure.message}\n   log: ${path.relative(ROOT, path.join(outDir, `${flow.id}.log`))}`,
      );
    } else {
      results.push({ id: flow.id, title: flow.title, status: 'pass' });
      console.log(`✔ ${seconds} s`);
    }
  }

  const report = reportMarkdown(results, { build: opts.build ?? `${appId} @ ${gitHead()}`, tier });
  fs.writeFileSync(
    path.join(outDir, 'report.md'),
    report + (ctx.notes.length ? `\n${ctx.notes.map((n) => `> ${n}`).join('\n')}\n` : ''),
  );
  console.log(`\n${report}`);
  for (const note of ctx.notes) console.log(`⚠ ${note}`);
  console.log(
    `${Math.round((Date.now() - started) / 60000)} min · screenshots, logs and JUnit in ${path.relative(ROOT, outDir)}/`,
  );
  if (results.some((r) => r.status === 'fail')) process.exit(1);
}

function gitHead() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

const HELP = `Runs the device checklist with Maestro on a USB-connected phone, against the throwaway
Firefly III (npm run ff3:test -- fresh first).

  npm run e2e                        the smoke (every build, ~5 min)
  npm run e2e -- release             everything (before a release)
  npm run e2e -- S3 Q2 P1            just these flows
  npm run e2e -- --changed [base]    the smoke + the flows for files changed since base (origin/main)
  npm run e2e -- release --list      print what would run, and exit
  npm run e2e -- selftest            check .maestro/scripts/ff3.js against the test instance (no phone)

Options
  --app-id <id>             default com.mkloouo.mmyway.dev (the Dev build; installs next to the real app)
  --apk <file>              install this build first (and U1's "new" build)
  --previous-apk <file>     U1: the previous release, installed first and upgraded over (it must
                            have the sign-in link too: built from a checkout with app/e2e-sign-in.tsx)
  --device <serial>         when several phones are connected
  --name <instance>         the ff3-test instance (default "default")
  --gemini-key <key>        R1: read receipts with Gemini ($GEMINI_KEY)
  --local-model-url <url>   R1: an OpenAI-compatible reader the phone can reach ($LOCAL_MODEL_URL)
  --local-model-name <name> its model ($LOCAL_MODEL_NAME)
  --lan                     T2: the phone is on the same Wi-Fi as this computer
  --second-instance         T3b: switch to a second throwaway Firefly III
  --manual-share            R1–R3: pause and let you share the photo by hand
  --no-reset                don't reset Firefly III to its seed first
  --keep-app-data           don't clear the app first
  --reinstall               start with empty app data by uninstalling and reinstalling the app
                            (--apk, or the APK already on the phone) — for phones that refuse
                            \`pm clear\` (SecurityException: CLEAR_APP_USER_DATA)
  --build <label>           the build name in the report

Results (report.md in the checklist's format, screenshots, Maestro logs, JUnit) go to
e2e-results/<time>-<run id>/.`;

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || opts._[0] === 'help') console.log(HELP);
  else if (opts._[0] === 'selftest') selftest(opts).catch((err) => fail(err.stack ?? String(err)));
  else run(opts).catch((err) => fail(err.stack ?? String(err)));
}
