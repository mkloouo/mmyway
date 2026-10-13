/// <reference types="node" />
// Runs scripts/wt.sh for real against throwaway repos. Each case gets its own
// repo (with its own copy of the script committed on main, like the real repo),
// so cases run concurrently. Install is always skipped. Check is skipped unless
// a case sets WT_SKIP_CHECK="" to exercise it, with a fake `bun` on PATH.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

jest.setTimeout(60_000);

const SCRIPT = path.join(__dirname, 'wt.sh');

const baseEnv: NodeJS.ProcessEnv = {
  ...process.env,
  // Keep the user's git config (commit signing, hooks, …) out of it.
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

function gitIn(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, env: baseEnv, encoding: 'utf8' }).trim();
}

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wt-test-')));

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

let repoCount = 0;

function makeRepo() {
  const n = ++repoCount;
  const repo = path.join(root, `r${n}`);
  const bin = path.join(root, `bin${n}`);
  const bunLog = path.join(root, `bun${n}.log`);
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(repo, 'package.json'), '{ "name": "fixture", "private": true }\n');
  fs.writeFileSync(path.join(repo, '.gitignore'), '/.worktrees/\n');
  fs.writeFileSync(
    path.join(repo, 'CHANGELOG.md'),
    '## [Unreleased]\n### Added\n<!-- added -->\n### Fixed\n<!-- fixed -->\n',
  );
  fs.copyFileSync(SCRIPT, path.join(repo, 'scripts', 'wt.sh'));
  fs.chmodSync(path.join(repo, 'scripts', 'wt.sh'), 0o755);
  fs.writeFileSync(
    path.join(bin, 'bun'),
    '#!/bin/sh\necho "bun $*" >> "$WT_TEST_BUN_LOG"\nexit "${WT_TEST_BUN_EXIT:-0}"\n',
  );
  fs.chmodSync(path.join(bin, 'bun'), 0o755);
  gitIn(repo, ['init', '-q', '-b', 'main']);
  gitIn(repo, ['add', '-A']);
  gitIn(repo, ['commit', '-q', '-m', 'init']);

  const env = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
    ...baseEnv,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    WT_SKIP_INSTALL: '1',
    WT_SKIP_CHECK: '1',
    WT_TEST_BUN_LOG: bunLog,
    ...extra,
  });

  const t = {
    repo,
    bunLog,
    git: (args: string[], cwd = repo) => gitIn(cwd, args),
    head: () => gitIn(repo, ['rev-parse', 'main']),
    wtPath: (id: string) => path.join(repo, '.worktrees', id),
    commitFile(dir: string, file: string, content: string, message: string) {
      fs.writeFileSync(path.join(dir, file), content);
      gitIn(dir, ['add', '-A']);
      gitIn(dir, ['commit', '-q', '-m', message]);
    },
    // Adds a CHANGELOG bullet for <id> and commits it, like step 5 of the protocol.
    addBullet(dir: string, id: string, marker = '<!-- added -->') {
      const file = path.join(dir, 'CHANGELOG.md');
      const text = fs.readFileSync(file, 'utf8');
      fs.writeFileSync(file, text.replace(marker, `- Change for ${id}. (${id})\n${marker}`));
      gitIn(dir, ['add', '-A']);
      gitIn(dir, ['commit', '-q', '-m', `${id}: changelog`]);
    },
    run(args: string[], cwd = repo, extra: Record<string, string> = {}) {
      return new Promise<{ code: number | null; stdout: string; out: string }>((resolve) => {
        const child = spawn(path.join(repo, 'scripts', 'wt.sh'), args, { cwd, env: env(extra) });
        let stdout = '';
        let out = '';
        child.stdout.on('data', (d) => {
          stdout += d;
          out += d;
        });
        child.stderr.on('data', (d) => (out += d));
        child.on('close', (code) => resolve({ code, stdout, out }));
      });
    },
  };
  return t;
}

type Repo = ReturnType<typeof makeRepo>;

async function startClaim(t: Repo, id: string) {
  const r = await t.run(['start', id]);
  expect(r.code).toBe(0);
  return path.join(t.repo, '.worktrees', id);
}

describe('scripts/wt.sh', () => {
  it.concurrent(
    'start creates .worktrees/<ID> on branch <ID> and prints WORKTREE last',
    async () => {
      const t = makeRepo();
      const r = await t.run(['start', 'MKL-1']);
      expect(r.code).toBe(0);
      const wt = t.wtPath('MKL-1');
      expect(fs.existsSync(path.join(wt, 'package.json'))).toBe(true);
      expect(t.git(['rev-parse', '--abbrev-ref', 'HEAD'], wt)).toBe('MKL-1');
      expect(r.stdout.trimEnd().split('\n').pop()).toBe(`WORKTREE: ${wt}`);
    },
  );

  it.concurrent('second start of a claimed ID exits 2 with ALREADY CLAIMED', async () => {
    const t = makeRepo();
    await startClaim(t, 'MKL-1');
    const r = await t.run(['start', 'MKL-1']);
    expect(r.code).toBe(2);
    expect(r.out).toContain('ALREADY CLAIMED: MKL-1');
  });

  it.concurrent('bad IDs, missing subcommand and unknown subcommand exit 64', async () => {
    const t = makeRepo();
    for (const args of [
      ['start', 'mkl-1'],
      ['start', 'MKL-'],
      ['start', 'MKL-1x'],
      ['start', 'FOO-1'],
      ['start'],
    ]) {
      const r = await t.run(args);
      expect({ args, code: r.code }).toEqual({ args, code: 64 });
    }
    const none = await t.run([]);
    expect(none.code).toBe(64);
    expect(none.out).toContain('Usage:');
    expect((await t.run(['frobnicate'])).code).toBe(64);
  });

  it.concurrent('finish with uncommitted changes exits 3 and lists them', async () => {
    const t = makeRepo();
    const wt = await startClaim(t, 'MKL-1');
    fs.writeFileSync(path.join(wt, 'notes.txt'), 'wip\n');
    const before = t.head();
    const r = await t.run(['finish', 'MKL-1'], wt);
    expect(r.code).toBe(3);
    expect(r.out).toContain('notes.txt');
    expect(t.head()).toBe(before);
  });

  it.concurrent('finish with no commits ahead of main exits 4', async () => {
    const t = makeRepo();
    const wt = await startClaim(t, 'MKL-1');
    const r = await t.run(['finish', 'MKL-1'], wt);
    expect(r.code).toBe(4);
    expect(r.out).toContain('NOTHING TO MERGE');
  });

  it.concurrent('start links .worktrees/release to a sibling release dir', async () => {
    const t = makeRepo();
    const sibling = path.join(root, 'release');
    fs.mkdirSync(sibling, { recursive: true });
    await startClaim(t, 'MKL-1');
    const link = path.join(t.repo, '.worktrees', 'release');
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(link)).toBe('../../release');
    expect(fs.realpathSync(link)).toBe(fs.realpathSync(sibling));
  });

  it.concurrent(
    'finish without a CHANGELOG bullet for <ID> exits 8 and merges nothing',
    async () => {
      const t = makeRepo();
      const wt = await startClaim(t, 'MKL-1');
      t.commitFile(wt, 'feature.txt', 'one\n', 'feat: one');
      t.addBullet(wt, 'MKL-9');
      const before = t.head();
      const r = await t.run(['finish', 'MKL-1'], wt);
      expect(r.code).toBe(8);
      expect(r.out).toContain('MISSING CHANGELOG: add a bullet ending with (MKL-1)');
      expect(t.head()).toBe(before);
      expect(fs.existsSync(wt)).toBe(true);
      t.addBullet(wt, 'MKL-1');
      expect((await t.run(['finish', 'MKL-1'], wt)).code).toBe(0);
    },
  );

  it.concurrent('finish happy path merges into main and removes worktree and branch', async () => {
    const t = makeRepo();
    const wt = await startClaim(t, 'MKL-1');
    t.commitFile(wt, 'feature.txt', 'one\n', 'feat: one');
    t.addBullet(wt, 'MKL-1');
    const r = await t.run(['finish', 'MKL-1'], wt);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/MERGED: MKL-1 -> main \([0-9a-f]+\)/);
    expect(t.git(['log', '--format=%s', 'main']).split('\n').slice(0, 2)).toEqual([
      'MKL-1: changelog',
      'feat: one',
    ]);
    expect(fs.readFileSync(path.join(t.repo, 'feature.txt'), 'utf8')).toBe('one\n');
    expect(fs.existsSync(wt)).toBe(false);
    expect(t.git(['branch', '--list', 'MKL-1'])).toBe('');
    expect(t.git(['worktree', 'list', '--porcelain'])).not.toContain('MKL-1');
  });

  it.concurrent(
    'two worktrees finish in sequence, the second one rebasing onto moved main',
    async () => {
      const t = makeRepo();
      const wt1 = await startClaim(t, 'MKL-1');
      const wt2 = await startClaim(t, 'MKL-2');
      t.commitFile(wt1, 'a.txt', 'a\n', 'feat: a');
      t.commitFile(wt2, 'b.txt', 'b\n', 'feat: b');
      t.addBullet(wt1, 'MKL-1');
      t.addBullet(wt2, 'MKL-2', '<!-- fixed -->');
      expect((await t.run(['finish', 'MKL-1'], wt1)).code).toBe(0);
      const r = await t.run(['finish', 'MKL-2'], wt2);
      expect(r.code).toBe(0);
      expect(t.git(['log', '--format=%s', 'main']).split('\n')).toEqual([
        'MKL-2: changelog',
        'feat: b',
        'MKL-1: changelog',
        'feat: a',
        'init',
      ]);
      expect(fs.existsSync(path.join(t.repo, 'a.txt'))).toBe(true);
      expect(fs.existsSync(path.join(t.repo, 'b.txt'))).toBe(true);
    },
  );

  it.concurrent(
    'conflicting edits: second finish exits 5, main and its branch unchanged',
    async () => {
      const t = makeRepo();
      const wt1 = await startClaim(t, 'MKL-1');
      const wt2 = await startClaim(t, 'MKL-2');
      t.commitFile(wt1, 'shared.txt', 'one\n', 'feat: one');
      t.commitFile(wt2, 'shared.txt', 'two\n', 'feat: two');
      t.addBullet(wt1, 'MKL-1');
      t.addBullet(wt2, 'MKL-2');
      expect((await t.run(['finish', 'MKL-1'], wt1)).code).toBe(0);
      const mainBefore = t.head();
      const branchBefore = t.git(['rev-parse', 'MKL-2']);
      const r = await t.run(['finish', 'MKL-2'], wt2);
      expect(r.code).toBe(5);
      expect(r.out).toContain('REBASE CONFLICT');
      expect(r.out).toContain('shared.txt');
      expect(r.out).toContain('git rebase --continue');
      expect(t.head()).toBe(mainBefore);
      expect(t.git(['rev-parse', 'MKL-2'])).toBe(branchBefore);
      expect(t.git(['status', '--porcelain'], wt2)).toBe('');
      expect(t.git(['rev-parse', '--abbrev-ref', 'HEAD'], wt2)).toBe('MKL-2');
    },
  );

  it.concurrent('finish with a dirty main checkout exits 6 and merges nothing', async () => {
    const t = makeRepo();
    const wt = await startClaim(t, 'MKL-1');
    t.commitFile(wt, 'feature.txt', 'one\n', 'feat: one');
    t.addBullet(wt, 'MKL-1');
    fs.writeFileSync(path.join(t.repo, 'stray.txt'), 'untracked\n');
    const before = t.head();
    const r = await t.run(['finish', 'MKL-1'], wt);
    expect(r.code).toBe(6);
    expect(r.out).toContain('MAIN CHECKOUT DIRTY');
    expect(t.head()).toBe(before);
    expect(fs.existsSync(wt)).toBe(true);
  });

  it.concurrent('finish stops without merging when check fails', async () => {
    const t = makeRepo();
    const wt = await startClaim(t, 'MKL-1');
    t.commitFile(wt, 'feature.txt', 'one\n', 'feat: one');
    t.addBullet(wt, 'MKL-1');
    const before = t.head();
    const r = await t.run(['finish', 'MKL-1'], wt, { WT_SKIP_CHECK: '', WT_TEST_BUN_EXIT: '1' });
    expect(r.code).toBe(1);
    expect(r.out).toContain('CHECK FAILED');
    expect(t.head()).toBe(before);
    expect(fs.existsSync(wt)).toBe(true);
  });

  it.concurrent('check from the main checkout exits 65', async () => {
    const t = makeRepo();
    const r = await t.run(['check'], t.repo);
    expect(r.code).toBe(65);
  });

  it.concurrent('check inside a worktree runs bun run check then bun run lint', async () => {
    const t = makeRepo();
    const wt = await startClaim(t, 'MKL-1');
    const r = await t.run(['check'], wt, { WT_SKIP_CHECK: '' });
    expect(r.code).toBe(0);
    expect(r.out).toContain('CHECK OK');
    expect(fs.readFileSync(t.bunLog, 'utf8')).toBe('bun run check\nbun run lint\n');
  });

  it.concurrent(
    'abort without --yes changes nothing; with --yes removes worktree and branch, not main',
    async () => {
      const t = makeRepo();
      const wt = await startClaim(t, 'MKL-1');
      t.commitFile(wt, 'feature.txt', 'one\n', 'feat: one');
      fs.writeFileSync(path.join(wt, 'scratch.txt'), 'junk\n');
      const before = t.head();

      const dry = await t.run(['abort', 'MKL-1']);
      expect(dry.code).toBe(1);
      expect(dry.out).toContain('--yes');
      expect(fs.existsSync(wt)).toBe(true);
      expect(t.git(['branch', '--list', 'MKL-1'])).toContain('MKL-1');

      const r = await t.run(['abort', 'MKL-1', '--yes']);
      expect(r.code).toBe(0);
      expect(fs.existsSync(wt)).toBe(false);
      expect(t.git(['branch', '--list', 'MKL-1'])).toBe('');
      expect(t.head()).toBe(before);
    },
  );
});
