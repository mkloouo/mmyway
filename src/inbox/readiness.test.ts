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

  describe('a currency the account does not hold (#105)', () => {
    const foreign: Draft = {
      ...base,
      currencyCode: 'EUR',
      type: 'withdrawal',
      sourceId: 'acc-1',
      destinationName: 'Lidl',
    };

    it('is not ready until the converted amount is set', () => {
      expect(draftReadiness(foreign, 'PLN')).toEqual({
        ready: false,
        missing: ['converted amount'],
      });
      expect(draftReadiness({ ...foreign, foreignAmount: '95.80' }, 'PLN').ready).toBe(true);
    });

    it('a zero converted amount still counts as missing', () => {
      expect(draftReadiness({ ...foreign, foreignAmount: '0.00' }, 'PLN').missing).toContain(
        'converted amount',
      );
    });

    it('is not asked for when the currencies match, or the account is unknown', () => {
      expect(draftReadiness({ ...foreign, currencyCode: 'PLN' }, 'PLN').ready).toBe(true);
      expect(draftReadiness(foreign).ready).toBe(true);
    });

    // A split draft asks for the converted total, which is shared out per split when it is
    // queued (#129) — it is no longer exempt from the rule.
    it('is asked for on a split draft too, as the converted total', () => {
      const split: Draft = {
        ...foreign,
        total: '20.00',
        amount: '12.00',
        extraSplits: [
          { amount: '8.00', description: 'second', payeeName: 'Lidl', isNewPayee: false },
        ],
      };
      expect(draftReadiness(split, 'PLN').missing).toContain('converted amount');
      expect(draftReadiness({ ...split, foreignAmount: '86.40' }, 'PLN').ready).toBe(true);
    });
  });
});
