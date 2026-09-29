import { draftReadiness } from './readiness';
import type { Draft } from './draft';

const base = {
  amount: '22.41',
  currencyCode: 'PLN',
  date: '2026-09-27T00:00:00.000Z',
  description: 'Żabka',
  isNewPayee: false,
};

describe('draftReadiness', () => {
  it('withdrawal is ready with amount, currency, source and payee', () => {
    const draft: Draft = {
      ...base,
      type: 'withdrawal',
      sourceId: 'acc-1',
      destinationName: 'Żabka',
    };
    expect(draftReadiness(draft)).toEqual({ ready: true, missing: [] });
  });

  it('withdrawal reports every missing field', () => {
    const draft: Draft = { ...base, type: 'withdrawal', amount: '0', currencyCode: '' };
    expect(draftReadiness(draft)).toEqual({
      ready: false,
      missing: ['amount', 'currency', 'source account', 'payee'],
    });
  });

  it('deposit is ready with amount, currency, destination and payee', () => {
    const draft: Draft = {
      ...base,
      type: 'deposit',
      destinationId: 'acc-1',
      sourceName: 'Employer',
    };
    expect(draftReadiness(draft)).toEqual({ ready: true, missing: [] });
  });

  it('deposit missing payee and destination', () => {
    const draft: Draft = { ...base, type: 'deposit' };
    expect(draftReadiness(draft)).toEqual({
      ready: false,
      missing: ['destination account', 'payee'],
    });
  });

  it('transfer is ready with amount, currency, source and destination, no payee needed', () => {
    const draft: Draft = { ...base, type: 'transfer', sourceId: 'acc-1', destinationId: 'acc-2' };
    expect(draftReadiness(draft)).toEqual({ ready: true, missing: [] });
  });

  it('transfer missing both accounts', () => {
    const draft: Draft = { ...base, type: 'transfer' };
    expect(draftReadiness(draft)).toEqual({
      ready: false,
      missing: ['source account', 'destination account'],
    });
  });

  it('zero-decimal amount strings are treated as zero', () => {
    const draft: Draft = {
      ...base,
      type: 'withdrawal',
      amount: '0.00',
      sourceId: 'acc-1',
      destinationName: 'Żabka',
    };
    expect(draftReadiness(draft).missing).toContain('amount');
  });

  it('Confirm all filters a mixed list down to the ready drafts', () => {
    const drafts: Draft[] = [
      { ...base, type: 'withdrawal', sourceId: 'acc-1', destinationName: 'Żabka' },
      { ...base, type: 'withdrawal', amount: '0', sourceId: 'acc-1', destinationName: 'Lidl' },
      { ...base, type: 'transfer', sourceId: 'acc-1', destinationId: 'acc-2' },
    ];
    const ready = drafts.filter((d) => draftReadiness(d).ready);
    expect(ready).toHaveLength(2);
  });
});
