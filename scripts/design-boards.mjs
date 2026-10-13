#!/usr/bin/env node
// Unpacks a design canvas export ("Money My Way — UI Unification & Redesigns - … .html", a bundle
// of gzip+base64 pages) into one readable HTML file per board, for docs/design/ (docs/UI_KIT.md).
// Icons (inline SVG) are dropped; layout, inline styles and copy are kept.
// Usage: node scripts/design-boards.mjs <export.html> <out-dir>
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const [file, outDir] = process.argv.slice(2);
if (!file || !outDir) {
  console.error('Usage: node scripts/design-boards.mjs <export.html> <out-dir>');
  process.exit(1);
}

const section = (html, type) => {
  const m = html.match(new RegExp(`<script type="__bundler/${type}">([\\s\\S]*?)</script>`));
  return m && JSON.parse(m[1]);
};
const unpack = (entry) => {
  const raw = Buffer.from(entry.data, 'base64');
  return (entry.compressed ? zlib.gunzipSync(raw) : raw).toString('utf8');
};

const outer = fs.readFileSync(file, 'utf8');
const manifest = section(outer, 'manifest');
fs.mkdirSync(outDir, { recursive: true });
section(outer, 'page_order').forEach((id, i) => {
  const page = unpack(manifest[id]);
  const board = (section(page, 'template') ?? page)
    .replace(/<svg[\s\S]*?<\/svg>/g, '<svg/>')
    .replace(/ sc-camel-view-box="[^"]*"/g, '');
  const title = page.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? id;
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const name = `${String(i + 1).padStart(2, '0')}-${slug}.html`;
  fs.writeFileSync(path.join(outDir, name), board);
  console.log(name);
});
