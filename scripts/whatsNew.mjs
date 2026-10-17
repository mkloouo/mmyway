// The "What's new" notes: one CHANGELOG.md version section, as the app bundles and shows it.
// Pure, so scripts/release.mjs (which writes src/about/whatsNew.json) and src/about/whatsNew.test.ts
// (which checks that file against CHANGELOG.md) run the same code and can't drift.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The newest released version: the first "## [x.y.z]" heading, skipping [Unreleased]. */
export function latestReleasedVersion(changelog) {
  return /^## \[(\d+\.\d+\.\d+)\]/m.exec(changelog)?.[1] ?? null;
}

/** Markdown out, text kept: **bold**, `code` and [links](url). */
function plain(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim();
}

/** `{ version, sections: [{ title, items: [text] }] }` for CHANGELOG.md's "## [version]" section. */
export function parseWhatsNew(changelog, version) {
  const heading = version.replace(/\./g, '\\.');
  const m = new RegExp(
    `^## \\[${heading}\\][^\\n]*\\n([\\s\\S]*?)(?=^## \\[|(?![\\s\\S]))`,
    'm',
  ).exec(changelog);
  if (!m) throw new Error(`CHANGELOG.md has no [${version}] section`);

  const sections = [];
  for (const line of m[1].split('\n')) {
    const h = /^### (.+)$/.exec(line);
    if (h) {
      sections.push({ title: h[1].trim(), items: [] });
      continue;
    }
    const section = sections.at(-1);
    if (!section) continue;
    const bullet = /^- (.+)$/.exec(line);
    if (bullet) section.items.push(plain(bullet[1]));
    else if (/^\s+\S/.test(line) && section.items.length > 0)
      // A wrapped bullet: its continuation lines belong to the item above.
      section.items[section.items.length - 1] += ` ${plain(line)}`;
  }
  return { version, sections: sections.filter((s) => s.items.length > 0) };
}

if (
  process.argv[1] &&
  typeof import.meta?.url === 'string' &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const changelogPath = path.join(root, 'CHANGELOG.md');
  const targetPath = path.join(root, 'src/about/whatsNew.json');
  const changelog = fs.readFileSync(changelogPath, 'utf8');
  const version = latestReleasedVersion(changelog);
  if (!version) {
    console.error('No released version found in CHANGELOG.md');
    process.exit(1);
  }
  const data = parseWhatsNew(changelog, version);
  fs.writeFileSync(targetPath, JSON.stringify(data, null, 2) + '\n');
  console.log(`Updated ${path.relative(root, targetPath)} to ${version}`);
}
