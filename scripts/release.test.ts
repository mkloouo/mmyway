/// <reference types="node" />
// Runs scripts/release.mjs for real against a throwaway repo with a local bare
// "origin". git, tar and unzip are real; `npx` (tsc, jest, EAS builds) and `gh`
// are stand-ins from ./release-test-stubs that log every call.
//
// Nearly all the time goes to waiting on child processes, so tests run
// concurrently, each on its own copy of a fixture built once in beforeAll.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

jest.setTimeout(30_000);

const STUBS = path.join(__dirname, 'release-test-stubs');
const APKS = ['arm64-v8a', 'armeabi-v7a', 'universal', 'x86', 'x86_64'].map(
  (abi) => `mmyway-v2.0.0-${abi}.apk`,
);

const CHANGELOG = `# Changelog

## [Unreleased]

### Added

- A new thing.

## [1.2.3] - 2026-01-01

### Fixed

- An old thing.
`;

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

function gitIn(cwd: string, args: string[], env = baseEnv): string {
  return execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
}

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'release-test-')));
const template = path.join(root, 'template');
let templateHead: string | undefined;

// Template layout, copied whole per test: repo/ pushes to ../origin.git (a
// relative remote, so every copy talks to its own origin), bin/ holds the stubs.
// Built on first use rather than in beforeAll, which Jest doesn't wait for
// before starting it.concurrent tests.
function buildTemplate(): string {
  if (templateHead) return templateHead;
  const repo = path.join(template, 'repo');
  const bin = path.join(template, 'bin');
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  fs.mkdirSync(bin);
  for (const tool of ['npx', 'gh']) {
    fs.copyFileSync(path.join(STUBS, `${tool}.js`), path.join(bin, tool));
    fs.chmodSync(path.join(bin, tool), 0o755);
  }

  gitIn(template, ['init', '-q', '--bare', '-b', 'main', 'origin.git']);
  gitIn(repo, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(
    path.join(repo, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '1.2.3', private: true }, null, 2) + '\n',
  );
  fs.writeFileSync(
    path.join(repo, 'app.config.js'),
    "module.exports = { expo: { name: 'Fixture', version: '1.2.3' } };\n",
  );
  fs.writeFileSync(path.join(repo, 'CHANGELOG.md'), CHANGELOG);
  fs.writeFileSync(path.join(repo, '.gitignore'), '/releases/\n');
  fs.copyFileSync(path.join(__dirname, 'release.mjs'), path.join(repo, 'scripts', 'release.mjs'));
  gitIn(repo, ['add', '-A']);
  gitIn(repo, ['commit', '-q', '-m', 'init']);
  gitIn(repo, ['remote', 'add', 'origin', '../origin.git']);
  gitIn(repo, ['push', '-q', '-u', 'origin', 'main']);
  templateHead = gitIn(repo, ['rev-parse', 'HEAD']);
  return templateHead;
}

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

let fixtureCount = 0;

function setup() {
  const initialHead = buildTemplate();
  const tmp = path.join(root, `t${++fixtureCount}`);
  fs.cpSync(template, tmp, { recursive: true });
  const repo = path.join(tmp, 'repo');
  const origin = path.join(tmp, 'origin.git');
  const log = path.join(tmp, 'calls.log');
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    PATH: `${path.join(tmp, 'bin')}${path.delimiter}${process.env.PATH}`,
    STUB_LOG: log,
    STUB_STATE: tmp,
  };

  const t = {
    tmp,
    repo,
    initialHead,
    outDir: path.join(repo, 'releases', 'v2.0.0'),

    git: (args: string[], cwd = repo) => gitIn(cwd, args, env),
    originGit: (args: string[]) => gitIn(tmp, ['--git-dir', origin, ...args], env),

    write(file: string, content: string) {
      fs.writeFileSync(path.join(repo, file), content);
    },

    commitAll(message: string) {
      t.git(['add', '-A']);
      t.git(['commit', '-q', '-m', message]);
    },

    // Async so concurrent tests' scripts overlap instead of queueing.
    release(args: string[], extraEnv: Record<string, string> = {}) {
      return new Promise<{ code: number | null; output: string }>((resolve) => {
        const child = spawn('node', [path.join(repo, 'scripts', 'release.mjs'), ...args], {
          cwd: repo,
          env: { ...env, ...extraEnv },
        });
        let output = '';
        child.stdout.on('data', (d) => (output += d));
        child.stderr.on('data', (d) => (output += d));
        child.on('close', (code) => resolve({ code, output }));
      });
    },

    calls(tool: 'npx' | 'gh'): string[][] {
      if (!fs.existsSync(log)) return [];
      return fs
        .readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as string[])
        .filter(([name]) => name === tool)
        .map(([, ...args]) => args);
    },

    pkgVersion: () => JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version,
    originTag: () => t.originGit(['tag', '--list', 'v2.0.0']),

    expectNothingPublished() {
      expect(t.originGit(['rev-parse', 'main'])).toBe(t.initialHead);
      expect(t.originTag()).toBe('');
      expect(t.calls('gh').some(([, sub]) => sub === 'create')).toBe(false);
    },

    async expectRefused(args: string[], message: string, extraEnv?: Record<string, string>) {
      const { code, output } = await t.release(args, extraEnv);
      expect(output).toContain(message);
      expect(code).toBe(1);
      expect(t.git(['rev-parse', 'HEAD'])).toBe(t.initialHead);
      t.expectNothingPublished();
    },
  };
  return t;
}

function today() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

describe('release.mjs', () => {
  it.concurrent(
    'runs a full release: checks, release commit, build, tag, push, published release',
    async () => {
      const t = setup();
      const { code, output } = await t.release(['2.0.0']);
      expect(output).toContain('✔ Released v2.0.0');
      expect(code).toBe(0);

      // Release commit: only the three version files, no trailer.
      expect(t.git(['log', '-1', '--format=%B'])).toBe('release v2.0.0');
      expect(t.git(['show', '--name-only', '--format=', 'HEAD']).split('\n').sort()).toEqual([
        'CHANGELOG.md',
        'app.config.js',
        'package.json',
      ]);
      expect(fs.readFileSync(path.join(t.repo, 'CHANGELOG.md'), 'utf8')).toBe(
        CHANGELOG.replace('## [Unreleased]\n', `## [Unreleased]\n\n## [2.0.0] - ${today()}\n`),
      );
      expect(t.pkgVersion()).toBe('2.0.0');
      expect(fs.readFileSync(path.join(t.repo, 'app.config.js'), 'utf8')).toContain(
        "version: '2.0.0'",
      );
      expect(t.git(['status', '--porcelain'])).toBe('');

      // Checks, then one local Android build.
      const npx = t.calls('npx');
      expect(npx[0]).toEqual(['tsc', '--noEmit']);
      expect(npx[1]).toEqual(['jest', '--ci']);
      expect(npx[2]).toEqual(
        expect.arrayContaining(['--platform', 'android', '--profile', 'production', '--local']),
      );
      expect(npx).toHaveLength(3);

      // Artifacts renamed, each split holding only its own ABI's libs.
      expect(fs.readdirSync(t.outDir).sort()).toEqual(
        [...APKS, 'SHA256SUMS', 'release-notes.md'].sort(),
      );
      for (const abi of ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64']) {
        const entries = execFileSync(
          'unzip',
          ['-Z1', path.join(t.outDir, `mmyway-v2.0.0-${abi}.apk`)],
          {
            encoding: 'utf8',
          },
        );
        expect(entries).toContain(`lib/${abi}/libapp.so`);
        expect(entries.match(/^lib\/[^/\n]+\//gm)?.every((e) => e === `lib/${abi}/`)).toBe(true);
      }

      // Checksums cover every downloadable file and match their contents.
      const sums = fs.readFileSync(path.join(t.outDir, 'SHA256SUMS'), 'utf8').trim().split('\n');
      expect(sums).toHaveLength(5);
      for (const line of sums) {
        const [hash, file] = line.split(/\s+/) as [string, string];
        expect(
          createHash('sha256')
            .update(fs.readFileSync(path.join(t.outDir, file)))
            .digest('hex'),
        ).toBe(hash);
      }

      // main and an annotated tag reached origin together.
      const head = t.git(['rev-parse', 'HEAD']);
      expect(t.originGit(['rev-parse', 'main'])).toBe(head);
      expect(t.originGit(['cat-file', '-t', 'refs/tags/v2.0.0'])).toBe('tag');
      expect(t.originGit(['rev-parse', 'v2.0.0^{commit}'])).toBe(head);

      // Draft release with every asset, then published.
      const gh = t.calls('gh');
      const create = gh.find(([, sub]) => sub === 'create')!;
      expect(create).toEqual(
        expect.arrayContaining(['--draft', '--verify-tag', '--title', 'v2.0.0']),
      );
      const assets = create.slice(3, create.indexOf('--draft'));
      expect(assets.map((a) => path.basename(a)).sort()).toEqual([...APKS, 'SHA256SUMS'].sort());
      expect(gh[gh.length - 2]).toEqual(['release', 'edit', 'v2.0.0', '--draft=false', '--latest']);

      const releaseNotes = fs.readFileSync(path.join(t.outDir, 'release-notes.md'), 'utf8');
      // Built from the version's CHANGELOG section only, then the footer.
      expect(releaseNotes.startsWith('### Added\n\n- A new thing.\n\n---\n')).toBe(true);
      expect(releaseNotes).not.toContain('An old thing.');
      expect(releaseNotes).toContain('`mmyway-v2.0.0-arm64-v8a.apk`');
    },
  );

  it.concurrent(
    '--pause builds everything but pushes nothing; --publish then finishes',
    async () => {
      const t = setup();
      const paused = await t.release(['2.0.0', '--pause']);
      expect(paused.code).toBe(0);
      expect(paused.output).toContain('Paused before tagging/publishing');
      expect(t.git(['log', '-1', '--format=%s'])).toBe('release v2.0.0');
      expect(fs.existsSync(path.join(t.outDir, 'SHA256SUMS'))).toBe(true);
      expect(t.git(['tag', '--list', 'v2.0.0'])).toBe('');
      t.expectNothingPublished();

      const published = await t.release(['2.0.0', '--publish']);
      expect(published.code).toBe(0);
      expect(t.originGit(['rev-parse', 'main'])).toBe(t.git(['rev-parse', 'HEAD']));
      expect(t.originTag()).toBe('v2.0.0');
      expect(fs.readFileSync(path.join(t.outDir, 'release-notes.md'), 'utf8')).toContain(
        '- A new thing.',
      );
    },
  );

  it.concurrent('--publish refuses artifacts changed after they were checksummed', async () => {
    const t = setup();
    await t.release(['2.0.0', '--pause']);
    fs.appendFileSync(path.join(t.outDir, 'mmyway-v2.0.0-universal.apk'), 'tampered');

    const { code, output } = await t.release(['2.0.0', '--publish']);
    expect(code).toBe(1);
    expect(output).toContain('checksum mismatch for mmyway-v2.0.0-universal.apk');
    t.expectNothingPublished();
  });

  it.concurrent('--publish resumes a release whose publish step failed partway', async () => {
    const t = setup();
    const first = await t.release(['2.0.0'], { STUB_FAIL: 'gh-publish' });
    expect(first.code).toBe(1);
    expect(t.originTag()).toBe('v2.0.0');

    const resumed = await t.release(['2.0.0', '--publish']);
    expect(resumed.code).toBe(0);
    const gh = t.calls('gh');
    expect(gh.filter(([, sub]) => sub === 'create')).toHaveLength(1);
    expect(gh.find(([, sub]) => sub === 'upload')).toEqual(expect.arrayContaining(['--clobber']));
    expect(JSON.parse(fs.readFileSync(path.join(t.tmp, 'release.json'), 'utf8'))).toEqual({
      tag: 'v2.0.0',
      draft: false,
    });
  });

  it.concurrent('without gh logged in, builds and tags locally but pushes nothing', async () => {
    const t = setup();
    const { code, output } = await t.release(['2.0.0'], { STUB_FAIL: 'gh-auth' });
    expect(code).toBe(0);
    expect(output).toContain('No GitHub remote/auth found');
    expect(t.git(['tag', '--list', 'v2.0.0'])).toBe('v2.0.0');
    expect(fs.existsSync(path.join(t.outDir, 'mmyway-v2.0.0-universal.apk'))).toBe(true);
    t.expectNothingPublished();
  });

  it.concurrent('--help explains every mode and option without needing a version', async () => {
    const t = setup();
    const { code, output } = await t.release(['--help']);
    expect(code).toBe(0);
    for (const opt of ['--pause', '--publish', '--abort']) {
      expect(output).toContain(opt);
    }
    expect(t.calls('npx')).toEqual([]);
  });

  describe('--abort', () => {
    it.concurrent('drops an unpushed release commit', async () => {
      const t = setup();
      await t.release(['2.0.0', '--pause']);
      const { code, output } = await t.release(['2.0.0', '--abort']);
      expect(code).toBe(0);
      expect(output).toContain('Dropped the unpushed "release v2.0.0" commit');
      expect(t.git(['rev-parse', 'HEAD'])).toBe(t.initialHead);
      expect(t.pkgVersion()).toBe('1.2.3');
      expect(t.git(['status', '--porcelain'])).toBe('');
    });

    it.concurrent('refuses once the release is on origin', async () => {
      const t = setup();
      await t.release(['2.0.0']);
      const { code, output } = await t.release(['2.0.0', '--abort']);
      expect(code).toBe(1);
      expect(output).toContain('already on origin/main');
    });

    it.concurrent("refuses when HEAD isn't the release commit", async () => {
      const t = setup();
      const { code, output } = await t.release(['2.0.0', '--abort']);
      expect(code).toBe(1);
      expect(output).toContain('nothing to abort');
    });
  });

  describe('refuses before touching anything', () => {
    it.concurrent('a dirty working tree', async () => {
      const t = setup();
      t.write('stray.txt', 'oops');
      await t.expectRefused(['2.0.0'], 'working tree is not clean');
      expect(t.calls('npx')).toEqual([]);
    });

    it.concurrent("a version that isn't newer", async () => {
      const t = setup();
      await t.expectRefused(['1.2.3'], '1.2.3 is not newer than the current 1.2.3');
      await t.expectRefused(['1.0.0'], '1.0.0 is not newer');
    });

    it.concurrent('main being behind origin', async () => {
      const t = setup();
      const other = path.join(t.tmp, 'other');
      t.git(['clone', '-q', 'origin.git', other], t.tmp);
      fs.writeFileSync(path.join(other, 'x.txt'), 'x');
      t.git(['add', '-A'], other);
      t.git(['commit', '-q', '-m', 'elsewhere'], other);
      t.git(['push', '-q', 'origin', 'main'], other);

      const { code, output } = await t.release(['2.0.0']);
      expect(code).toBe(1);
      expect(output).toContain('main is behind origin/main');
      expect(t.git(['rev-parse', 'HEAD'])).toBe(t.initialHead);
    });

    it.concurrent('a tag that already exists locally', async () => {
      const t = setup();
      t.git(['tag', 'v2.0.0']);
      await t.expectRefused(['2.0.0'], 'tag v2.0.0 already exists locally');
    });

    it.concurrent('a tag that already exists on origin', async () => {
      const t = setup();
      // Tagged off main's history, so `git fetch` doesn't bring it down.
      const other = path.join(t.tmp, 'other');
      t.git(['clone', '-q', 'origin.git', other], t.tmp);
      t.git(['checkout', '-q', '-b', 'side'], other);
      t.git(['commit', '-q', '--allow-empty', '-m', 'side'], other);
      t.git(['tag', 'v2.0.0'], other);
      t.git(['push', '-q', 'origin', 'v2.0.0'], other);

      const { code, output } = await t.release(['2.0.0']);
      expect(output).toContain('tag v2.0.0 already exists on origin');
      expect(code).toBe(1);
      expect(t.git(['rev-parse', 'HEAD'])).toBe(t.initialHead);
    });

    it.concurrent('an unknown flag, instead of running a full release', async () => {
      const t = setup();
      await t.expectRefused(
        ['2.0.0', '--publish-ios-only'],
        'unknown argument "--publish-ios-only"',
      );
      expect(t.calls('npx')).toEqual([]);
      expect(t.calls('gh')).toEqual([]);
    });

    it.concurrent('failing tests', async () => {
      const t = setup();
      await t.expectRefused(['2.0.0'], '`npx jest --ci` failed', { STUB_FAIL: 'jest' });
      expect(t.calls('npx').some((c) => c[0] === 'eas-cli')).toBe(false);
    });

    it.concurrent('an empty [Unreleased] section', async () => {
      const t = setup();
      t.write(
        'CHANGELOG.md',
        '# Changelog\n\n## [Unreleased]\n\n## [1.2.3] - 2026-01-01\n\n- An old thing.\n',
      );
      t.commitAll('empty unreleased');
      t.git(['push', '-q', 'origin', 'main']);
      t.initialHead = t.git(['rev-parse', 'HEAD']);
      await t.expectRefused(['2.0.0'], 'CHANGELOG.md has nothing under [Unreleased]');
    });
  });

  describe('rejects bad Android build output without publishing', () => {
    it.concurrent('a missing split APK', async () => {
      const t = setup();
      const { code, output } = await t.release(['2.0.0'], {
        STUB_SPLITS: 'arm64-v8a,armeabi-v7a,x86',
      });
      expect(code).toBe(1);
      expect(output).toContain("don't match the universal APK's ABIs");
      t.expectNothingPublished();
    });

    it.concurrent("a split APK carrying another ABI's libs", async () => {
      const t = setup();
      const { code, output } = await t.release(['2.0.0'], {
        STUB_LEAKY_SPLIT: 'arm64-v8a',
      });
      expect(code).toBe(1);
      expect(output).toContain(
        'app-arm64-v8a-release.apk contains native libs for [arm64-v8a,armeabi-v7a]',
      );
      t.expectNothingPublished();
    });

    it.concurrent('a failed build', async () => {
      const t = setup();
      const { code, output } = await t.release(['2.0.0'], { STUB_FAIL: 'eas-android' });
      expect(code).toBe(1);
      expect(output).toContain('--platform android');
      t.expectNothingPublished();
    });
  });
});
