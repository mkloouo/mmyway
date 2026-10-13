#!/usr/bin/env node
// Creates in Flagsmith every flag listed in src/flags/registry.ts that the project doesn't have
// yet, switched off. It never deletes or switches anything: flags that exist only in Flagsmith,
// and descriptions that differ, are reported. Run it after adding a flag (docs/FEATURE_FLAGS.md).
//
// Reads .env.local: FLAGSMITH_API_URL (https://<host>/api/v1), FLAGSMITH_ADMIN_API_KEY (an
// Organisation API key; never ship it in the app), FLAGSMITH_PROJECT_ID.
// Usage: npm run flags:sync [-- --dry-run]
import dotenv from 'dotenv';
import { FLAGS } from '../src/flags/registry.ts';

dotenv.config({ path: '.env.local', quiet: true });

const dryRun = process.argv.includes('--dry-run');
const apiUrl = process.env.FLAGSMITH_API_URL?.replace(/\/+$/, '');
const adminKey = process.env.FLAGSMITH_ADMIN_API_KEY;
const projectId = process.env.FLAGSMITH_PROJECT_ID;

if (!apiUrl || !adminKey) {
  console.error(
    'Set FLAGSMITH_API_URL and FLAGSMITH_ADMIN_API_KEY in .env.local (see .env.example).',
  );
  process.exit(1);
}

async function api(path, init = {}) {
  const res = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Api-Key ${adminKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });
  if (!res.ok)
    throw new Error(`${init.method ?? 'GET'} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Every page of a paginated list endpoint (or the plain array older Flagsmith versions return). */
async function list(path) {
  const items = [];
  let next = `${path}${path.includes('?') ? '&' : '?'}page_size=100`;
  while (next) {
    const page = await api(next);
    if (Array.isArray(page)) return page;
    items.push(...page.results);
    next = page.next ? page.next.slice(page.next.indexOf('/api/v1') + '/api/v1'.length) : null;
  }
  return items;
}

if (!projectId) {
  const projects = await list('/projects/');
  console.error('Set FLAGSMITH_PROJECT_ID in .env.local. Projects this key can see:');
  for (const p of projects) console.error(`  ${p.id}\t${p.name}`);
  process.exit(1);
}

const existing = new Map((await list(`/projects/${projectId}/features/`)).map((f) => [f.name, f]));

let created = 0;
for (const [name, { description }] of Object.entries(FLAGS)) {
  const feature = existing.get(name);
  if (feature) {
    if ((feature.description ?? '') !== description) {
      console.log(`~ ${name}: description in Flagsmith differs from the registry (left as is)`);
    }
    continue;
  }
  console.log(`${dryRun ? 'would create' : '+ create'} ${name} (off)`);
  if (!dryRun) {
    await api(`/projects/${projectId}/features/`, {
      method: 'POST',
      body: JSON.stringify({ name, description, default_enabled: false, type: 'STANDARD' }),
    });
    created++;
  }
}

for (const name of existing.keys()) {
  if (!(name in FLAGS)) console.log(`? ${name}: in Flagsmith but not in src/flags/registry.ts`);
}
console.log(dryRun ? 'Dry run, nothing changed.' : `Done: ${created} created.`);
