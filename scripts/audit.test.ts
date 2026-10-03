/// <reference types="node" />
// The allowlist in scripts/audit.mjs must never swallow an advisory it wasn't told about.
import { advisoriesIn, review } from './audit.mjs';

/** `npm audit --omit=dev --json`'s shape, cut down to what the script reads. */
const report = (...advisories: { id: string; name: string; severity: string }[]) => ({
  vulnerabilities: Object.fromEntries(
    advisories.map((a) => [
      a.name,
      {
        name: a.name,
        severity: a.severity,
        via: [
          {
            source: 1,
            name: a.name,
            severity: a.severity,
            title: `${a.name} is vulnerable`,
            url: `https://github.com/advisories/${a.id}`,
          },
        ],
      },
    ]),
  ),
});

const allowed = [{ id: 'GHSA-known', package: 'braces', through: 'expo → …', why: 'build only' }];

describe('advisoriesIn', () => {
  it('keeps high and critical, drops the rest', () => {
    const found = advisoriesIn(
      report(
        { id: 'GHSA-a', name: 'one', severity: 'critical' },
        { id: 'GHSA-b', name: 'two', severity: 'high' },
        { id: 'GHSA-c', name: 'three', severity: 'moderate' },
        { id: 'GHSA-d', name: 'four', severity: 'low' },
      ),
    );
    expect(found.map((a: { id: string }) => a.id).sort()).toEqual(['GHSA-a', 'GHSA-b']);
  });

  it('counts an advisory once however many packages npm lists it under', () => {
    const twice = report(
      { id: 'GHSA-a', name: 'one', severity: 'high' },
      { id: 'GHSA-a', name: 'two', severity: 'high' },
    );
    expect(advisoriesIn(twice)).toHaveLength(1);
  });

  it('reads nothing out of an empty audit', () => {
    expect(advisoriesIn({ vulnerabilities: {} })).toEqual([]);
    expect(advisoriesIn({})).toEqual([]);
  });
});

describe('review', () => {
  it('fails on an advisory nobody has written down', () => {
    const { blocking } = review(
      report({ id: 'GHSA-new', name: 'ships', severity: 'high' }),
      allowed,
    );
    expect(blocking.map((a: { id: string }) => a.id)).toEqual(['GHSA-new']);
  });

  it('passes an allowlisted one, and still fails on a new one beside it', () => {
    const { blocking, skipped } = review(
      report(
        { id: 'GHSA-known', name: 'braces', severity: 'high' },
        { id: 'GHSA-new', name: 'ships', severity: 'critical' },
      ),
      allowed,
    );
    expect(skipped.map((a) => a.id)).toEqual(['GHSA-known']);
    expect(blocking.map((a: { id: string }) => a.id)).toEqual(['GHSA-new']);
  });

  it('names an allowlist entry that is no longer reported, so the list does not rot', () => {
    const { stale, blocking } = review(report(), allowed);
    expect(stale.map((a) => a.id)).toEqual(['GHSA-known']);
    expect(blocking).toEqual([]); // a stale entry is a note, never a new red build
  });
});
