import { FLAG_NAMES } from '../flags/registry';
import { e2eLinksEnabled, parseFlagsParam, signInLinkParams } from './signInLink';

describe('e2eLinksEnabled', () => {
  it('answers in the Dev build only', () => {
    expect(e2eLinksEnabled('development')).toBe(true);
    expect(e2eLinksEnabled('preview')).toBe(true);
  });

  it('says no to a real build, and to anything it does not recognise', () => {
    for (const variant of [
      'production',
      'Development',
      '',
      undefined,
      null,
      1,
      {},
      ['development'],
    ])
      expect(e2eLinksEnabled(variant)).toBe(false);
  });
});

describe('signInLinkParams', () => {
  it('reads the address and the token', () => {
    expect(
      signInLinkParams({ host: ' http://localhost:8080 ', token: 'eyJ0eXAi.abc_d-e' }),
    ).toEqual({ host: 'http://localhost:8080', token: 'eyJ0eXAi.abc_d-e' });
  });

  it('takes the first of a repeated parameter', () => {
    expect(signInLinkParams({ host: ['http://a', 'http://b'], token: ['t1', 't2'] })).toEqual({
      host: 'http://a',
      token: 't1',
    });
  });

  it('gives an empty string for a missing one, which then fails to sign in', () => {
    expect(signInLinkParams({})).toEqual({ host: '', token: '' });
    expect(signInLinkParams({ host: undefined, token: [] })).toEqual({ host: '', token: '' });
  });

  it('reads flags when provided', () => {
    expect(
      signInLinkParams({
        host: 'http://localhost',
        token: 'tok',
        flags: ' budget,demo_mode ',
      }),
    ).toEqual({
      host: 'http://localhost',
      token: 'tok',
      flags: 'budget,demo_mode',
    });
  });
});

describe('parseFlagsParam', () => {
  it('sets named flags to true and every other flag in FLAG_NAMES to false', () => {
    const overrides = parseFlagsParam('budget,demo_mode');
    expect(overrides.budget).toBe(true);
    expect(overrides.demo_mode).toBe(true);

    for (const name of FLAG_NAMES) {
      if (name !== 'budget' && name !== 'demo_mode') {
        expect(overrides[name]).toBe(false);
      }
    }
  });

  it('turns all flags off when empty string or unrecognized flag is passed', () => {
    const emptyOverrides = parseFlagsParam('');
    for (const name of FLAG_NAMES) {
      expect(emptyOverrides[name]).toBe(false);
    }

    const unknownOverrides = parseFlagsParam('non_existent_flag');
    for (const name of FLAG_NAMES) {
      expect(unknownOverrides[name]).toBe(false);
    }
  });
});
