/// <reference types="node" />
// scripts/e2e.mjs's flow list against the files in .maestro/: every step exists, every flow file is
// in the list, and picking flows by tier or id works. Running them needs a phone (npm run e2e).
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SCRIPT = path.join(__dirname, 'e2e.mjs');
const MAESTRO = path.join(__dirname, '..', '.maestro');
const list = (...args: string[]) =>
  JSON.parse(
    execFileSync(process.execPath, [SCRIPT, ...args, '--list', '--json'], { encoding: 'utf8' }),
  ) as {
    id: string;
    steps: (string | { host: string; fixture?: string })[];
    requires: string[];
  }[];

describe('e2e flows', () => {
  const all = list('release');

  it('covers the device checklist', () => {
    expect(all.map((f) => f.id)).toEqual(
      expect.arrayContaining([
        'S1',
        'S2',
        'S3',
        'S4',
        'S5',
        'S6',
        'C1',
        'C6',
        'R1',
        'R2',
        'R3',
        'Q1',
        'Q5',
        'A1',
        'A3',
        'P1',
        'P2',
        'K1',
        'T1',
        'T5',
        'U1',
      ]),
    );
    expect(new Set(all.map((f) => f.id)).size).toBe(all.length);
  });

  it('points only at flow files and fixtures that exist', () => {
    for (const flow of all) {
      for (const step of flow.steps) {
        if (typeof step === 'string')
          expect(fs.existsSync(path.join(MAESTRO, 'flows', step))).toBe(true);
        else if (step.fixture)
          expect(fs.existsSync(path.join(MAESTRO, 'fixtures', step.fixture))).toBe(true);
      }
    }
  });

  it('leaves no flow file out of the list', () => {
    const listed = new Set(
      all.flatMap((f) => f.steps.filter((s): s is string => typeof s === 'string')),
    );
    for (const area of fs.readdirSync(path.join(MAESTRO, 'flows'))) {
      for (const file of fs.readdirSync(path.join(MAESTRO, 'flows', area)))
        expect(listed.has(`${area}/${file}`) ? file : `${area}/${file} is not in FLOWS`).toBe(file);
    }
  });

  it('runs the smoke by default, and picks flows by id', () => {
    expect(list().map((f) => f.id)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
    expect(list('q2', 'S3').map((f) => f.id)).toEqual(['S3', 'Q2']);
  });

  it('refuses an unknown flow', () => {
    const r = spawnSync(process.execPath, [SCRIPT, 'Z9', '--list'], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('unknown flow(s): Z9');
  });
});
