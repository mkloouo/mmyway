import { e2eLinksEnabled, signInLinkParams } from './signInLink';

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
});
