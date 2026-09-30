#!/usr/bin/env node
// A throwaway Firefly III for device tests: a patched FF3 in Docker on SQLite, seeded with known
// data, snapshotted, and reset in seconds. The Maestro flows (.maestro/, scripts/e2e.mjs) run the
// app against it instead of your real books. `npm run ff3:test -- --help` for usage.
//
// Each instance lives in .ff3-test/<name>/ (gitignored): the rendered docker-compose.yaml,
// db/database.sqlite, snapshots/*.sqlite and state.json (address, login, API token). The Passport
// signing keys are generated once per instance and passed in as env, so the token survives the
// container being recreated. Patches in tools/ff3-test/patches/ are mounted read-only, the same
// way the production server mounts them.
//
// Never point this at a real Firefly III: every command assumes the instance is disposable.

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HOME = process.env.FF3_TEST_HOME ?? path.join(ROOT, '.ff3-test');
const TOOLS = path.join(ROOT, 'tools', 'ff3-test');
const PATCHES = JSON.parse(fs.readFileSync(path.join(TOOLS, 'patches', 'patches.json'), 'utf8'));
const DEFAULT_IMAGE = process.env.FF3_TEST_IMAGE ?? `fireflyiii/core:version-${PATCHES.basedOn}`;
const EMAIL = 'test@mmyway.local';
const HEALTH_TIMEOUT_MS = 240_000;

// ---------- helpers ----------

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}
const say = (message) => console.log(`▶ ${message}`);
const ok = (message) => console.log(`✔ ${message}`);

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
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) opts[key] = argv[++i];
    else opts[key] = true;
  }
  return opts;
}

function docker(args, { capture = false, allowFail = false, input } = {}) {
  const r = spawnSync('docker', args, {
    encoding: 'utf8',
    stdio: capture || input !== undefined ? ['pipe', 'pipe', 'pipe'] : 'inherit',
    input,
  });
  if (r.error) fail(`docker is not available: ${r.error.message}`);
  if (r.status !== 0 && !allowFail)
    fail(`\`docker ${args.join(' ')}\` failed (exit ${r.status})\n${r.stderr ?? ''}`);
  return r;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort(start) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(freePort(start + 1)));
    server.listen(start, '127.0.0.1', () => server.close(() => resolve(start)));
  });
}

/** The laptop's address on the local network, for a phone on the same Wi-Fi (no adb reverse). */
export function lanAddress() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const a of addresses ?? []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return null;
}

// ---------- instance state ----------

function dirOf(name) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name))
    fail(`instance names are lower-case letters, digits and -: ${name}`);
  return path.join(HOME, name);
}

function readState(name, { required = true } = {}) {
  const file = path.join(dirOf(name), 'state.json');
  if (!fs.existsSync(file)) {
    if (required)
      fail(`no instance "${name}" — create it with: npm run ff3:test -- fresh --name ${name}`);
    return null;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeState(state) {
  fs.writeFileSync(
    path.join(dirOf(state.name), 'state.json'),
    JSON.stringify(state, null, 2) + '\n',
  );
}

const project = (name) => `mmyway-ff3-${name}`;
const container = (name) => `mmyway-ff3-${name}`;
const url = (state) => `http://localhost:${state.port}`;

function compose(state, args, opts) {
  return docker(
    [
      'compose',
      '-p',
      project(state.name),
      '-f',
      path.join(dirOf(state.name), 'docker-compose.yaml'),
      ...args,
    ],
    opts,
  );
}

/** The compose file for one instance. Exported through `compose --print` for the tests. */
export function renderCompose(state, keys, patches = state.patches ? PATCHES.patches : []) {
  const indent = (pem) =>
    pem
      .trim()
      .split('\n')
      .map((line) => `        ${line}`)
      .join('\n');
  const mounts = [
    './db:/var/www/html/storage/database',
    ...patches.map((p) => `${path.join(TOOLS, 'patches', p.file)}:${p.target}:ro`),
  ];
  return `# Rendered by scripts/ff3-test.mjs — edit the script, not this file.
name: ${project(state.name)}
services:
  app:
    image: ${state.image}
    container_name: ${container(state.name)}
    restart: 'no'
    ports:
      - '${state.port}:8080'
    environment:
      APP_KEY: '${state.appKey}'
      APP_URL: 'http://localhost:${state.port}'
      SITE_OWNER: '${EMAIL}'
      TZ: '${state.tz}'
      DB_CONNECTION: sqlite
      TRUSTED_PROXIES: '**'
      # Some Docker hosts have no IPv6; FF3's nginx refuses to start when it can't bind [::].
      NGINX_LISTEN_IP_PROTOCOL: ipv4
      STATIC_CRON_TOKEN: '${state.cronToken}'
      PASSPORT_PRIVATE_KEY: |
${indent(keys.privateKey)}
      PASSPORT_PUBLIC_KEY: |
${indent(keys.publicKey)}
    volumes:
${mounts.map((m) => `      - '${m}'`).join('\n')}
`;
}

function readKeys(name) {
  const dir = path.join(dirOf(name), 'passport');
  return {
    privateKey: fs.readFileSync(path.join(dir, 'private.pem'), 'utf8'),
    publicKey: fs.readFileSync(path.join(dir, 'public.pem'), 'utf8'),
  };
}

function writeCompose(state) {
  fs.writeFileSync(
    path.join(dirOf(state.name), 'docker-compose.yaml'),
    renderCompose(state, readKeys(state.name)),
  );
}

// ---------- HTTP ----------

async function health(state) {
  try {
    const r = await fetch(`${url(state)}/health`, { signal: AbortSignal.timeout(3000) });
    return r.status === 200;
  } catch {
    return false;
  }
}

async function waitHealthy(state) {
  const until = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < until) {
    if (await health(state)) return;
    const running = docker(['inspect', '-f', '{{.State.Running}}', container(state.name)], {
      capture: true,
      allowFail: true,
    });
    if (running.stdout.trim() === 'false')
      fail(`the container stopped — see: npm run ff3:test -- logs --name ${state.name}`);
    await sleep(2000);
  }
  fail(`Firefly III didn't answer ${url(state)}/health within ${HEALTH_TIMEOUT_MS / 1000} s`);
}

async function api(state, method, apiPath, body) {
  const r = await fetch(`${url(state)}/api/v1${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${state.token}`,
      Accept: 'application/json',
      // FF3 refuses a POST without one, even with no body.
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${apiPath} → ${r.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

async function tokenWorks(state) {
  if (!state.token) return false;
  try {
    await api(state, 'GET', '/about');
    return true;
  } catch {
    return false;
  }
}

/** A cookie jar just big enough for FF3's registration form. */
function jar() {
  const cookies = new Map();
  return {
    take(response) {
      for (const c of response.headers.getSetCookie?.() ?? []) {
        const [pair] = c.split(';');
        const eq = pair.indexOf('=');
        cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
      }
    },
    header: () => [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
  };
}

async function register(state) {
  const cookies = jar();
  const form = await fetch(`${url(state)}/register`, { redirect: 'manual' });
  cookies.take(form);
  const html = await form.text();
  const csrf = /name="_token" value="([^"]+)"/.exec(html)?.[1];
  if (!csrf)
    fail(
      'the registration form is closed, so a user exists that this helper did not create.\n' +
        `  Start over with: npm run ff3:test -- fresh --name ${state.name}`,
    );
  const r = await fetch(`${url(state)}/register`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookies.header() },
    body: new URLSearchParams({
      _token: csrf,
      email: EMAIL,
      password: state.password,
      password_confirmation: state.password,
    }),
  });
  const to = r.headers.get('location') ?? '';
  if (r.status !== 302 || to.includes('/register'))
    fail(`registration was refused (${r.status} → ${to || 'no redirect'})`);
}

// ---------- PHP inside the container ----------

function php(name, code) {
  const boot =
    'require "vendor/autoload.php"; $app = require "bootstrap/app.php"; ' +
    '$app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap(); ';
  const r = docker(['exec', '-i', '-w', '/var/www/html', container(name), 'php'], {
    input: `<?php ${boot}${code}`,
    capture: true,
    allowFail: true,
  });
  return { ok: r.status === 0, out: r.stdout, err: r.stderr };
}

function artisan(name, args, opts) {
  return docker(['exec', '-w', '/var/www/html', container(name), 'php', 'artisan', ...args], opts);
}

function createToken(name) {
  const code =
    'try { echo "TOKEN:" . FireflyIII\\User::where("email", "' +
    EMAIL +
    '")->firstOrFail()->createToken("mmyway-test")->accessToken; } ' +
    'catch (Throwable $e) { echo "ERROR:" . $e->getMessage(); }';
  let r = php(name, code);
  if (/ERROR:.*(personal access client|Personal access client)/i.test(r.out)) {
    artisan(name, ['passport:client', '--personal', '--no-interaction', '--name=mmyway-test'], {
      capture: true,
    });
    r = php(name, code);
  }
  const token = /TOKEN:(\S+)/.exec(r.out)?.[1];
  if (!token) fail(`could not create an API token:\n${r.out}\n${r.err}`);
  return token;
}

// ---------- seeding ----------

function isoDay(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Resolves a seed entry's relative date; exported through `seed --plan` for the tests. */
export function seedDates(entry, today = new Date()) {
  const dates = [];
  const at = (monthsAgo, day) => {
    const d = new Date(today.getFullYear(), today.getMonth() - monthsAgo, 1);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day ?? 1, last));
    return d > today ? new Date(today) : d;
  };
  if (entry.eachMonth) {
    for (let m = entry.eachMonth.from; m <= entry.eachMonth.to; m++) dates.push(at(m, entry.day));
  } else if (entry.monthsAgo !== undefined) {
    dates.push(at(entry.monthsAgo, entry.day));
  } else {
    const d = new Date(today);
    d.setDate(d.getDate() - (entry.daysAgo ?? 0));
    dates.push(d);
  }
  return dates.map(isoDay);
}

export function seedTransactions(seed, today = new Date()) {
  const out = [];
  for (const entry of seed.transactions) {
    for (const date of seedDates(entry, today)) {
      const month = date.slice(0, 7);
      out.push({
        error_if_duplicate_hash: false,
        apply_rules: false,
        fire_webhooks: false,
        ...(entry.group_title ? { group_title: entry.group_title } : {}),
        transactions: entry.splits.map((s) => ({
          ...s,
          date,
          description: s.description.replaceAll('{month}', month),
        })),
      });
    }
  }
  return out;
}

async function seed(state, file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const oldest = new Date();
  oldest.setMonth(oldest.getMonth() - 12);
  for (const code of data.currencies.enable) await api(state, 'POST', `/currencies/${code}/enable`);
  await api(state, 'POST', `/currencies/${data.currencies.primary}/primary`);
  for (const a of data.accounts) {
    const body = { ...a };
    if (a.opening_balance) body.opening_balance_date = isoDay(oldest);
    await api(state, 'POST', '/accounts', body);
  }
  for (const name of data.categories) await api(state, 'POST', '/categories', { name });
  for (const name of data.budgets) await api(state, 'POST', '/budgets', { name });
  for (const b of data.bills) {
    const { day, ...rest } = b;
    const first = new Date();
    first.setDate(day);
    await api(state, 'POST', '/bills', { ...rest, date: isoDay(first) });
  }
  const groups = seedTransactions(data);
  for (const g of groups) await api(state, 'POST', '/transactions', g);
  return { accounts: data.accounts.length, transactions: groups.length };
}

// ---------- commands ----------

async function cmdUp(opts) {
  const name = opts.name ?? 'default';
  const dir = dirOf(name);
  let state = readState(name, { required: false });
  if (!state) {
    fs.mkdirSync(path.join(dir, 'db'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'snapshots'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'passport'), { recursive: true });
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 4096,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    fs.writeFileSync(path.join(dir, 'passport', 'private.pem'), privateKey, { mode: 0o600 });
    fs.writeFileSync(path.join(dir, 'passport', 'public.pem'), publicKey);
    const db = path.join(dir, 'db', 'database.sqlite');
    fs.writeFileSync(db, '');
    // The container's PHP runs as www-data; the bind mount must be writable for it.
    fs.chmodSync(path.join(dir, 'db'), 0o777);
    fs.chmodSync(db, 0o666);
    state = {
      name,
      port: Number(opts.port ?? (await freePort(name === 'default' ? 8080 : 8081))),
      image: opts.image ?? DEFAULT_IMAGE,
      tz: opts.tz ?? 'Europe/Warsaw',
      patches: !opts['no-patches'],
      appKey: crypto.randomBytes(16).toString('hex'),
      cronToken: crypto.randomBytes(16).toString('hex'),
      email: EMAIL,
      password: crypto.randomBytes(12).toString('base64url'),
      token: null,
      createdAt: new Date().toISOString(),
      seededAt: null,
    };
    writeState(state);
  } else {
    if (opts.image) state.image = opts.image;
    if (opts['no-patches']) state.patches = false;
    writeState(state);
  }
  writeCompose(state);
  say(`starting ${state.image} as "${name}" on ${url(state)}${state.patches ? ' (patched)' : ''}`);
  compose(state, ['up', '-d']);
  await waitHealthy(state);
  await checkPatchBase(state);
  ok(`Firefly III is up at ${url(state)}`);
  return state;
}

async function checkPatchBase(state) {
  if (!state.patches || !state.token) return;
  try {
    const about = await api(state, 'GET', '/about');
    if (about.data.version !== PATCHES.basedOn)
      console.warn(
        `⚠ the patches were written against ${PATCHES.basedOn}, this is ${about.data.version}; ` +
          'check tools/ff3-test/patches/ still matches the upstream files',
      );
  } catch {
    // no token yet; `init` checks again
  }
}

async function cmdInit(opts) {
  const state = readState(opts.name ?? 'default');
  if (!(await health(state)))
    fail(`"${state.name}" isn't running — npm run ff3:test -- up --name ${state.name}`);
  if (await tokenWorks(state)) {
    ok('already initialised; the saved token works');
    return state;
  }
  const users = php(state.name, 'echo "USERS:" . FireflyIII\\User::count();');
  const count = Number(/USERS:(\d+)/.exec(users.out)?.[1] ?? NaN);
  if (count === 0) {
    say(`registering ${EMAIL}`);
    await register(state);
  }
  say('creating an API token');
  state.token = createToken(state.name);
  writeState(state);
  if (!(await tokenWorks(state))) fail('the new token was refused by the API');
  await checkPatchBase(state);
  ok(`initialised — log in to ${url(state)} as ${EMAIL} / ${state.password}`);
  return state;
}

async function cmdSeed(opts) {
  const file = path.resolve(opts.file ?? path.join(TOOLS, 'seed.json'));
  if (opts.plan) {
    // What the seed would POST, with today's dates; needs no instance (the tests use it).
    console.log(
      JSON.stringify(seedTransactions(JSON.parse(fs.readFileSync(file, 'utf8'))), null, 2),
    );
    return;
  }
  const state = readState(opts.name ?? 'default');
  if (state.seededAt && !opts.force)
    fail(
      `"${state.name}" was seeded at ${state.seededAt}; reset it, or pass --force to seed again`,
    );
  if (!(await tokenWorks(state))) fail('no working token — run init first');
  say(`seeding from ${path.relative(ROOT, file)}`);
  const counts = await seed(state, file);
  state.seededAt = new Date().toISOString();
  writeState(state);
  ok(`seeded ${counts.accounts} accounts and ${counts.transactions} transactions`);
}

function snapshotPath(state, label) {
  if (!/^[\w.-]+$/.test(label)) fail(`snapshot names are letters, digits, . _ -: ${label}`);
  return path.join(dirOf(state.name), 'snapshots', `${label}.sqlite`);
}

async function cmdSnapshot(opts) {
  const state = readState(opts.name ?? 'default');
  const label = opts._[1] ?? opts.as ?? 'seed';
  say(`snapshot "${label}" (the container stops for a moment so the file is consistent)`);
  compose(state, ['stop'], { capture: true });
  fs.copyFileSync(
    path.join(dirOf(state.name), 'db', 'database.sqlite'),
    snapshotPath(state, label),
  );
  fs.writeFileSync(
    snapshotPath(state, label) + '.json',
    JSON.stringify({ seededAt: state.seededAt, at: new Date().toISOString() }) + '\n',
  );
  compose(state, ['start'], { capture: true });
  await waitHealthy(state);
  ok(`saved ${path.relative(ROOT, snapshotPath(state, label))}`);
}

async function cmdReset(opts) {
  const state = readState(opts.name ?? 'default');
  const label = opts._[1] ?? opts.to ?? 'seed';
  const file = snapshotPath(state, label);
  if (!fs.existsSync(file))
    fail(`no snapshot "${label}" — take one with: npm run ff3:test -- snapshot ${label}`);
  say(`resetting "${state.name}" to snapshot "${label}"`);
  compose(state, ['stop'], { capture: true });
  const db = path.join(dirOf(state.name), 'db', 'database.sqlite');
  fs.copyFileSync(file, db);
  fs.chmodSync(db, 0o666);
  for (const extra of ['-wal', '-shm', '-journal']) fs.rmSync(db + extra, { force: true });
  const meta = fs.existsSync(file + '.json')
    ? JSON.parse(fs.readFileSync(file + '.json', 'utf8'))
    : {};
  state.seededAt = meta.seededAt ?? state.seededAt;
  writeState(state);
  compose(state, ['up', '-d'], { capture: true });
  await waitHealthy(state);
  if (!(await tokenWorks(state)))
    fail('the saved token no longer works after the reset — run: fresh');
  ok(`reset to "${label}"`);
}

async function cmdFresh(opts) {
  const name = opts.name ?? 'default';
  if (readState(name, { required: false })) await cmdDestroy({ ...opts, name, quiet: true });
  await cmdUp({ ...opts, name });
  await cmdInit({ name });
  if (!opts['no-seed']) {
    await cmdSeed({ name, _: [], file: opts.file });
    await cmdSnapshot({ name, _: ['snapshot', 'seed'] });
  }
  await cmdStatus({ name });
}

async function cmdStatus(opts) {
  const names = opts.name ? [opts.name] : listNames();
  if (names.length === 0)
    return console.log('No instances. Create one with: npm run ff3:test -- fresh');
  for (const name of names) {
    const state = readState(name);
    const running = docker(['inspect', '-f', '{{.State.Status}}', container(name)], {
      capture: true,
      allowFail: true,
    });
    const healthy = await health(state);
    const snapshots = fs
      .readdirSync(path.join(dirOf(name), 'snapshots'))
      .filter((f) => f.endsWith('.sqlite'))
      .map((f) => f.replace(/\.sqlite$/, ''));
    console.log(`\n${name}`);
    console.log(
      `  container  ${running.status === 0 ? running.stdout.trim() : 'not created'}${healthy ? ', healthy' : ''}`,
    );
    console.log(
      `  address    ${url(state)}   (phone over USB: npm run ff3:test -- adb-reverse${name === 'default' ? '' : ` --name ${name}`})`,
    );
    const lan = lanAddress();
    if (lan) console.log(`  on Wi-Fi   http://${lan}:${state.port}`);
    console.log(`  image      ${state.image}${state.patches ? ' + patches' : ' (unpatched)'}`);
    console.log(`  web login  ${state.email} / ${state.password}`);
    console.log(
      `  token      ${state.token ? (healthy && (await tokenWorks(state)) ? 'works' : 'saved (not checked)') : 'none — run init'}`,
    );
    console.log(`  seeded     ${state.seededAt ?? 'no'}`);
    console.log(`  snapshots  ${snapshots.join(', ') || 'none'}`);
  }
}

function listNames() {
  if (!fs.existsSync(HOME)) return [];
  return fs.readdirSync(HOME).filter((n) => fs.existsSync(path.join(HOME, n, 'state.json')));
}

function cmdEnv(opts) {
  const state = readState(opts.name ?? 'default');
  const lan = lanAddress();
  const env = {
    FF3_URL: url(state),
    FF3_LAN_URL: lan ? `http://${lan}:${state.port}` : '',
    FF3_TOKEN: state.token ?? '',
    FF3_EMAIL: state.email,
    FF3_PASSWORD: state.password,
  };
  if (opts.format === 'json') return console.log(JSON.stringify(env, null, 2));
  for (const [k, v] of Object.entries(env)) console.log(`export ${k}='${v}'`);
}

function cmdCron(opts) {
  const state = readState(opts.name ?? 'default');
  const args = ['firefly-iii:cron', '--force'];
  if (opts.date) args.push(`--date=${opts.date}`);
  say(
    `running Firefly III's cron${opts.date ? ` for ${opts.date}` : ''} (recurring transactions, bills, …)`,
  );
  artisan(state.name, args);
}

function cmdAdbReverse(opts) {
  const state = readState(opts.name ?? 'default');
  const r = spawnSync('adb', ['reverse', `tcp:${state.port}`, `tcp:${state.port}`], {
    stdio: 'inherit',
  });
  if (r.error || r.status !== 0)
    fail('adb reverse failed — is the phone connected with USB debugging on?');
  ok(`the phone reaches this instance at ${url(state)}`);
}

function cmdLogs(opts) {
  const state = readState(opts.name ?? 'default');
  docker(
    [
      'logs',
      ...(opts.follow || opts.f ? ['-f'] : ['--tail', String(opts.tail ?? 100)]),
      container(state.name),
    ],
    {
      allowFail: true,
    },
  );
}

function cmdShell(opts) {
  const state = readState(opts.name ?? 'default');
  spawnSync('docker', ['exec', '-it', '-w', '/var/www/html', container(state.name), 'sh'], {
    stdio: 'inherit',
  });
}

function cmdDown(opts) {
  const state = readState(opts.name ?? 'default');
  compose(state, ['down']);
  ok(`stopped "${state.name}"; its data stays — \`up\` brings it back`);
}

async function cmdDestroy(opts) {
  const name = opts.name ?? 'default';
  const state = readState(name, { required: false });
  if (!state) return opts.quiet || console.log(`no instance "${name}"`);
  if (fs.existsSync(path.join(dirOf(name), 'docker-compose.yaml')))
    compose(state, ['down', '--remove-orphans'], { capture: true, allowFail: true });
  // The container wrote the database as www-data; removing it needs no special rights on the host
  // because the directory was created by us.
  fs.rmSync(dirOf(name), { recursive: true, force: true });
  ok(`destroyed "${name}" and its data`);
}

function cmdCompose(opts) {
  // For the tests and for curiosity: the compose file an instance would get, with dummy keys.
  const state = {
    name: opts.name ?? 'default',
    port: Number(opts.port ?? 8080),
    image: opts.image ?? DEFAULT_IMAGE,
    tz: opts.tz ?? 'Europe/Warsaw',
    patches: !opts['no-patches'],
    appKey: 'x'.repeat(32),
    cronToken: 'y'.repeat(32),
  };
  const dummy = '-----BEGIN KEY-----\nAAAA\n-----END KEY-----\n';
  process.stdout.write(renderCompose(state, { privateKey: dummy, publicKey: dummy }));
}

const HELP = `Throwaway Firefly III for device tests (Docker, SQLite, patched like production).

  npm run ff3:test -- <command> [--name default]

Lifecycle
  fresh                 destroy + up + init + seed + snapshot "seed": a clean, known instance
  up                    create or start the container and wait until it answers
                        [--port 8080] [--image ${DEFAULT_IMAGE}] [--tz Europe/Warsaw] [--no-patches]
  init                  register ${EMAIL} and save an API token (idempotent)
  seed                  load tools/ff3-test/seed.json [--file other.json] [--force] [--plan: print only]
  snapshot [label]      save the database as a snapshot (default "seed")
  reset [label]         restore a snapshot (default "seed") — seconds, the token keeps working
  down                  stop and remove the container; data stays
  destroy               remove the container and all of the instance's data

Use it
  status                every instance: address, login, token, snapshots
  env [--format json]   FF3_URL, FF3_TOKEN, … as shell exports (eval "$(npm run -s ff3:test -- env)")
  adb-reverse           make http://localhost:<port> on the USB-connected phone reach this instance
  cron [--date Y-M-D]   run Firefly III's cron now: books due recurring transactions
  logs [--follow]       container logs
  shell                 a shell inside the container

Tests
  compose [--print]     print the compose file an instance would get (dummy keys)

Several instances side by side (e.g. to test switching): --name second --port 8081.
Patches: tools/ff3-test/patches/patches.json lists files mounted over the image, like production.`;

const COMMANDS = {
  fresh: cmdFresh,
  up: cmdUp,
  init: cmdInit,
  seed: cmdSeed,
  snapshot: cmdSnapshot,
  reset: cmdReset,
  down: cmdDown,
  destroy: cmdDestroy,
  status: cmdStatus,
  env: cmdEnv,
  'adb-reverse': cmdAdbReverse,
  cron: cmdCron,
  logs: cmdLogs,
  shell: cmdShell,
  compose: cmdCompose,
};

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const opts = parseArgs(process.argv.slice(2));
  const command = opts._[0];
  if (!command || opts.help || command === 'help') {
    console.log(HELP);
  } else if (!COMMANDS[command]) {
    fail(`unknown command "${command}" — see --help`);
  } else {
    Promise.resolve(COMMANDS[command](opts)).catch((err) => fail(err.stack ?? String(err)));
  }
}
