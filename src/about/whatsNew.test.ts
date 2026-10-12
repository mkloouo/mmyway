/// <reference types="node" />
// The bundled "What's new" notes are the latest released CHANGELOG.md section, parsed by the same
// code scripts/release.mjs runs when it cuts a release, so the app and the changelog can't drift.
import fs from 'node:fs';
import path from 'node:path';
import { latestReleasedVersion, parseWhatsNew } from '../../scripts/whatsNew.mjs';
import whatsNew from './whatsNew.json';

const changelog = fs.readFileSync(path.join(__dirname, '../../CHANGELOG.md'), 'utf8');

describe('src/about/whatsNew.json', () => {
  it('is the latest released CHANGELOG.md section', () => {
    const latest = latestReleasedVersion(changelog);
    expect(latest).not.toBeNull();
    expect(whatsNew).toEqual(parseWhatsNew(changelog, latest!));
  });

  it('holds plain text: no bold or code markers', () => {
    expect(JSON.stringify(whatsNew)).not.toMatch(/\*\*|`/);
  });
});
