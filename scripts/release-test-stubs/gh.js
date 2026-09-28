#!/usr/bin/env node
// Stand-in for `gh` in scripts/release.test.ts. Keeps one release's state in
// $STUB_STATE/release.json; `release create --verify-tag` checks the tag really
// is on origin, like the real flag does.
//   STUB_FAIL   comma list: gh-auth, gh-publish (the final `edit --draft=false`)
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
fs.appendFileSync(process.env.STUB_LOG, JSON.stringify(['gh', ...args]) + '\n');
const failing = (process.env.STUB_FAIL || '').split(',');
const stateFile = path.join(process.env.STUB_STATE, 'release.json');
const load = () => (fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : null);
const save = (state) => fs.writeFileSync(stateFile, JSON.stringify(state));

const [cmd, sub, tag] = args;
if (cmd === 'auth') process.exit(failing.includes('gh-auth') ? 1 : 0);
if (cmd !== 'release') {
  console.error(`gh stub: unexpected command ${cmd}`);
  process.exit(1);
}

const release = load();
switch (sub) {
  case 'view':
    if (release?.tag !== tag) process.exit(1);
    if (args.includes('--json')) console.log(`https://github.com/example/app/releases/tag/${tag}`);
    break;
  case 'create':
    if (args.includes('--verify-tag') && execFileSync('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`], { encoding: 'utf8' }).trim() === '') {
      console.error(`gh stub: tag ${tag} doesn't exist on origin`);
      process.exit(1);
    }
    save({ tag, draft: args.includes('--draft') });
    break;
  case 'upload':
    break;
  case 'edit':
    if (args.includes('--draft=false')) {
      if (failing.includes('gh-publish')) process.exit(1);
      save({ ...release, draft: false });
    }
    break;
  default:
    console.error(`gh stub: unexpected release ${sub}`);
    process.exit(1);
}
