import { FLAGS } from './registry';
import { resolveAll, resolveFlag } from './resolve';

describe('resolveFlag', () => {
  it('falls back to the code default when nothing else is set', () => {
    expect(resolveFlag('budget', {})).toBe(FLAGS.budget.default);
  });

  it('lets the Flagsmith value win over the default', () => {
    expect(resolveFlag('budget', { budget: true })).toBe(true);
    expect(resolveFlag('budget', { budget: false })).toBe(false);
  });

  it('lets a local override win over the Flagsmith value', () => {
    expect(resolveFlag('budget', { budget: false }, { budget: true })).toBe(true);
    expect(resolveFlag('budget', { budget: true }, { budget: false })).toBe(false);
  });
});

describe('resolveAll', () => {
  it('returns every flag, all at their defaults when nothing is known', () => {
    const all = resolveAll({});
    expect(Object.keys(all).sort()).toEqual(Object.keys(FLAGS).sort());
    for (const name of Object.keys(FLAGS) as (keyof typeof FLAGS)[]) {
      expect(all[name]).toBe(FLAGS[name].default);
    }
  });

  it('applies remote values and overrides per flag', () => {
    const all = resolveAll({ budget: true, ff3_rules: true }, { ff3_rules: false });
    expect(all.budget).toBe(true);
    expect(all.ff3_rules).toBe(false);
    expect(all.demo_mode).toBe(FLAGS.demo_mode.default);
  });
});
