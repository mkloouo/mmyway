#!/usr/bin/env node
// Stand-in for `npx` in scripts/release.test.ts. Fakes tsc/jest and the EAS
// Android build: writes a .tar.gz of zipped split + universal APKs, like a
// real local build with ABI splits.
//   STUB_FAIL          comma list of steps to fail: tsc, jest, eas-android
//   STUB_SPLITS        comma list of split ABIs to emit (default: all four)
//   STUB_LEAKY_SPLIT   split ABI whose APK also carries another ABI's libs
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const args = process.argv.slice(2);
fs.appendFileSync(process.env.STUB_LOG, JSON.stringify(['npx', ...args]) + '\n');
const failing = (process.env.STUB_FAIL || '').split(',');
const option = (name) => args[args.indexOf(name) + 1];

const [tool] = args;
if (tool === 'tsc' || tool === 'jest') process.exit(failing.includes(tool) ? 1 : 0);
if (tool !== 'eas-cli') {
  console.error(`npx stub: unexpected command ${tool}`);
  process.exit(1);
}

const platform = option('--platform');
if (failing.includes(`eas-${platform}`)) process.exit(1);

const ABIS = ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64'];
const splits = process.env.STUB_SPLITS !== undefined ? process.env.STUB_SPLITS.split(',').filter(Boolean) : ABIS;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'eas-stub-'));
const outputs = path.join(work, 'outputs', 'apk', 'release');
fs.mkdirSync(outputs, { recursive: true });

function apk(name, libAbis) {
  const stage = path.join(work, name);
  for (const abi of libAbis) {
    fs.mkdirSync(path.join(stage, 'lib', abi), { recursive: true });
    fs.writeFileSync(path.join(stage, 'lib', abi, 'libapp.so'), `${name}:${abi}`);
  }
  fs.writeFileSync(path.join(stage, 'classes.dex'), name);
  execFileSync('zip', ['-qr', path.join(outputs, `app-${name}-release.apk`), '.'], { cwd: stage });
}

apk('universal', ABIS);
for (const abi of splits) {
  apk(abi, abi === process.env.STUB_LEAKY_SPLIT ? [abi, ABIS.find((a) => a !== abi)] : [abi]);
}
execFileSync('tar', ['-czf', option('--output'), '-C', outputs, '.']);
fs.rmSync(work, { recursive: true });
