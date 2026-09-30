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

const evalModule = (code: string) => {
  const out = execFileSync(
    process.execPath,
    ['--input-type=module', '-e', `import * as e2e from './scripts/e2e.mjs';\n${code}`],
    { encoding: 'utf8', cwd: path.join(__dirname, '..') },
  );
  const lines = out.trim().split('\n');
  return JSON.parse(lines[lines.length - 1]!);
};

const evalModuleError = (code: string) => {
  const r = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', `import * as e2e from './scripts/e2e.mjs';\n${code}`],
    { encoding: 'utf8', cwd: path.join(__dirname, '..') },
  );
  return r.stderr;
};

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

  describe('iOS simulator runs', () => {
    it('parses iOS and app arguments', () => {
      expect(
        evalModule(
          `console.log(JSON.stringify(e2e.parseArgs(['--ios', '--app', 'build/mmyway.app', '--previous-app', 'build/prev.app'])))`,
        ),
      ).toEqual({
        _: [],
        ios: true,
        app: 'build/mmyway.app',
        'previous-app': 'build/prev.app',
      });
      expect(
        evalModule(
          `console.log(JSON.stringify(e2e.parseArgs(['--platform', 'ios', '--device', 'iPhone 16'])))`,
        ),
      ).toEqual({
        _: [],
        platform: 'ios',
        device: 'iPhone 16',
      });
    });

    it('selects a single booted simulator automatically', () => {
      const res = evalModule(`
        const mockSimctl = (args) => JSON.stringify({
          devices: {
            'runtime': [
              { udid: 'booted-udid-1', name: 'iPhone 16', state: 'Booted', isAvailable: true },
              { udid: 'shutdown-udid-2', name: 'iPhone 16 Pro', state: 'Shutdown', isAvailable: true },
            ],
          },
        });
        console.log(JSON.stringify(e2e.findIosSimulator(undefined, { simctlFn: mockSimctl })));
      `);
      expect(res).toBe('booted-udid-1');
    });

    it('fails when multiple simulators are booted without --device', () => {
      const err = evalModuleError(`
        const mockSimctl = () => JSON.stringify({
          devices: {
            runtime: [
              { udid: 'u1', name: 'iPhone 16', state: 'Booted', isAvailable: true },
              { udid: 'u2', name: 'iPhone 17', state: 'Booted', isAvailable: true },
            ],
          },
        });
        e2e.findIosSimulator(undefined, { simctlFn: mockSimctl });
      `);
      expect(err).toContain('several booted simulators');
    });

    it('fails when no simulator is booted without --device', () => {
      const err = evalModuleError(`
        const mockSimctl = () => JSON.stringify({
          devices: {
            runtime: [
              { udid: 'u1', name: 'iPhone 16', state: 'Shutdown', isAvailable: true },
            ],
          },
        });
        e2e.findIosSimulator(undefined, { simctlFn: mockSimctl });
      `);
      expect(err).toContain('no iOS simulator is booted');
    });

    it('finds simulator by name and boots it if shutdown', () => {
      const res = evalModule(`
        let bootedUdid = null;
        const mockSimctl = (args) => {
          if (args[0] === 'list') {
            return JSON.stringify({
              devices: {
                runtime: [
                  { udid: 'u1', name: 'iPhone 16', state: 'Shutdown', isAvailable: true },
                ],
              },
            });
          }
          if (args[0] === 'boot') {
            bootedUdid = args[1];
            return '';
          }
          return '';
        };
        const udid = e2e.findIosSimulator('iPhone 16', { simctlFn: mockSimctl });
        console.log(JSON.stringify({ udid, bootedUdid }));
      `);
      expect(res).toEqual({ udid: 'u1', bootedUdid: 'u1' });
    });

    it('finds simulator by UDID without booting if already booted', () => {
      const res = evalModule(`
        let bootedCalled = false;
        const mockSimctl = (args) => {
          if (args[0] === 'list') {
            return JSON.stringify({
              devices: {
                runtime: [
                  { udid: 'my-udid', name: 'iPhone 16', state: 'Booted', isAvailable: true },
                ],
              },
            });
          }
          if (args[0] === 'boot') {
            bootedCalled = true;
          }
          return '';
        };
        const udid = e2e.findIosSimulator('my-udid', { simctlFn: mockSimctl });
        console.log(JSON.stringify({ udid, bootedCalled }));
      `);
      expect(res).toEqual({ udid: 'my-udid', bootedCalled: false });
    });

    it('fails when requested simulator is not found', () => {
      const err = evalModuleError(`
        const mockSimctl = () => JSON.stringify({
          devices: {
            runtime: [
              { udid: 'u1', name: 'iPhone 16', state: 'Shutdown', isAvailable: true },
            ],
          },
        });
        e2e.findIosSimulator('iPad Pro', { simctlFn: mockSimctl });
      `);
      expect(err).toContain('no iOS simulator matches "iPad Pro"');
    });

    it('selects Android device correctly', () => {
      const res = evalModule(`
        const mockAdb = () => ({ stdout: 'List of devices attached\\nemulator-5554\\tdevice\\n' });
        console.log(JSON.stringify(e2e.findAndroidDevice(undefined, { adbFn: mockAdb })));
      `);
      expect(res).toBe('emulator-5554');

      const err = evalModuleError(`
        const mockAdb = () => ({ stdout: 'List of devices attached\\n' });
        e2e.findAndroidDevice(undefined, { adbFn: mockAdb });
      `);
      expect(err).toContain('no phone connected');
    });

    it('checks missing requirements on iOS vs Android', () => {
      const res = evalModule(`
        const lanFlow = { id: 'T2', requires: ['lan'], steps: [] };
        const apksFlow = { id: 'U1', requires: ['apks'], steps: [] };
        const workManagerFlow = { id: 'Q5', steps: [{ host: 'backgroundJob' }] };
        const shareFlow = { id: 'R2', steps: [{ host: 'share', fixture: 'f.jpg' }] };

        console.log(JSON.stringify({
          androidLan: e2e.requirementsMissing(lanFlow, { platform: 'android', opts: {}, env: {} }),
          androidApks: e2e.requirementsMissing(apksFlow, { platform: 'android', opts: {}, env: {} }),
          androidWm: e2e.requirementsMissing(workManagerFlow, { platform: 'android', opts: {}, env: {} }),
          iosLan: e2e.requirementsMissing(lanFlow, { platform: 'ios', opts: { lan: true }, env: { FF3_LAN_URL: 'http://...' } }),
          iosApksMissing: e2e.requirementsMissing(apksFlow, { platform: 'ios', opts: {}, env: {} }),
          iosApksProvided: e2e.requirementsMissing(apksFlow, { platform: 'ios', opts: { app: 'new.app', 'previous-app': 'old.app' }, env: {} }),
          iosWm: e2e.requirementsMissing(workManagerFlow, { platform: 'ios', opts: {}, env: {} }),
          iosShareNoManual: e2e.requirementsMissing(shareFlow, { platform: 'ios', opts: {}, env: {} }),
          iosShareManual: e2e.requirementsMissing(shareFlow, { platform: 'ios', opts: { 'manual-share': true }, env: {} }),
        }));
      `);
      expect(res.androidLan).toContain('--lan (phone on the same Wi-Fi as this computer)');
      expect(res.androidApks).toContain('--apk and --previous-apk');
      expect(res.androidWm).toEqual([]);
      expect(res.iosLan).toContain('--lan is not supported on iOS simulator (no Wi-Fi toggle)');
      expect(res.iosApksMissing).toContain('--app and --previous-app');
      expect(res.iosApksProvided).toEqual([]);
      expect(res.iosWm).toContain('Android WorkManager (not available on iOS)');
      expect(res.iosShareNoManual).toContain(
        '--manual-share (sharing photos into app is manual on iOS simulator)',
      );
      expect(res.iosShareManual).toEqual([]);
    });

    it('checks if app is installed on iOS simulator', () => {
      const res = evalModule(`
        const mockSimctl = (args) => args[2] === 'com.mkloouo.mmyway.dev' ? process.cwd() : '';
        console.log(JSON.stringify({
          installed: e2e.isInstalledIos('com.mkloouo.mmyway.dev', 'sim-1', { simctlFn: mockSimctl }),
          notInstalled: e2e.isInstalledIos('com.other.app', 'sim-1', { simctlFn: mockSimctl }),
        }));
      `);
      expect(res.installed).toBe(true);
      expect(res.notInstalled).toBe(false);
    });

    it('checks sign in link scheme for iOS', () => {
      const res = evalModule(`
        import fs from 'node:fs';
        import os from 'node:os';
        import path from 'node:path';

        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-app-'));
        const plist = path.join(tmp, 'Info.plist');
        fs.writeFileSync(plist, '<?xml version=\"1.0\" encoding=\"UTF-8\"?><!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\"><plist version=\"1.0\"><dict><key>CFBundleURLTypes</key><array><dict><key>CFBundleURLSchemes</key><array><string>mmyway-dev</string></array></dict></array></dict></plist>');

        const mockSimctlDev = () => tmp;
        const answersDev = e2e.answersSignInLinkIos('com.mkloouo.mmyway.dev', 'sim-1', { simctlFn: mockSimctlDev });

        fs.writeFileSync(plist, '<?xml version=\"1.0\" encoding=\"UTF-8\"?><!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\"><plist version=\"1.0\"><dict><key>CFBundleURLTypes</key><array><dict><key>CFBundleURLSchemes</key><array><string>mmyway</string></array></dict></array></dict></plist>');
        const answersProd = e2e.answersSignInLinkIos('com.mkloouo.mmyway', 'sim-1', { simctlFn: mockSimctlDev });

        fs.rmSync(tmp, { recursive: true, force: true });
        console.log(JSON.stringify({ answersDev, answersProd }));
      `);
      expect(res.answersDev).toBe(true);
      expect(res.answersProd).toBe(false);
    });

    it('documents iOS simulator options in help', () => {
      const r = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('--ios');
      expect(r.stdout).toContain('--platform <android|ios>');
      expect(r.stdout).toContain('--app <path>');
      expect(r.stdout).toContain('--previous-app <path>');
    });
  });
});
