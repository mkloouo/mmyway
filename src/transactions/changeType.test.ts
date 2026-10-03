import { endsReady, rewireForType, type TxEnds } from './changeType';

// A card of the user's, and the shop they paid.
const expense: TxEnds = {
  sourceId: 'card',
  sourceName: 'Revolut PLN',
  destinationId: 'shop',
  destinationName: 'Żabka',
};
const income: TxEnds = {
  sourceId: null,
  sourceName: 'Employer',
  destinationId: 'card',
  destinationName: 'Revolut PLN',
};
const transfer: TxEnds = {
  sourceId: 'card',
  sourceName: 'Revolut PLN',
  destinationId: 'savings',
  destinationName: 'Savings EUR',
};

describe('rewireForType', () => {
  it('turns an expense into an income: the card takes the money in, the shop becomes the payer', () => {
    expect(rewireForType('withdrawal', 'deposit', expense)).toEqual({
      type: 'deposit',
      source_id: null,
      source_name: 'Żabka',
      destination_id: 'card',
      destination_name: null,
    });
  });

  it('turns an income into an expense: the card pays, the payer becomes the payee', () => {
    expect(rewireForType('deposit', 'withdrawal', income)).toEqual({
      type: 'withdrawal',
      source_id: 'card',
      source_name: null,
      destination_id: null,
      destination_name: 'Employer',
    });
  });

  it('keeps an income arriving in the same account when it becomes a transfer', () => {
    expect(rewireForType('deposit', 'transfer', income)).toEqual({
      type: 'transfer',
      source_id: null, // the account it comes from is the one thing only the user can say
      source_name: null,
      destination_id: 'card',
      destination_name: null,
    });
  });

  it('keeps an expense leaving the same account when it becomes a transfer', () => {
    expect(rewireForType('withdrawal', 'transfer', expense)).toEqual({
      type: 'transfer',
      source_id: 'card',
      source_name: null,
      destination_id: null,
      destination_name: null,
    });
  });

  it('a transfer becoming an expense keeps the account it left and asks for the payee', () => {
    expect(rewireForType('transfer', 'withdrawal', transfer)).toEqual({
      type: 'withdrawal',
      source_id: 'card',
      source_name: null,
      destination_id: null,
      // The account it went to is not a payee: naming it one would invent an expense account.
      destination_name: null,
    });
  });

  it('a transfer becoming an income keeps the account it arrived in and asks for the payer', () => {
    expect(rewireForType('transfer', 'deposit', transfer)).toEqual({
      type: 'deposit',
      source_id: null,
      source_name: null,
      destination_id: 'savings',
      destination_name: null,
    });
  });

  it('always keeps one of the accounts it had, whichever pair it goes through', () => {
    const kinds = ['withdrawal', 'deposit', 'transfer'] as const;
    for (const from of kinds)
      for (const to of kinds) {
        const ends = from === 'withdrawal' ? expense : from === 'deposit' ? income : transfer;
        const next = rewireForType(from, to, ends);
        const kept = [next.source_id, next.destination_id].filter(Boolean);
        // A transfer has two of them and an expense or an income only one, so going down to one
        // drops the other — but something of the user's own is always still there.
        expect(kept.length).toBeGreaterThan(0);
        expect([ends.sourceId, ends.destinationId]).toContain(kept[0]);
      }
  });
});

describe('endsReady', () => {
  it('an expense needs an account to pay from and someone to pay', () => {
    expect(endsReady('withdrawal', expense)).toBe(true);
    expect(endsReady('withdrawal', { ...expense, sourceId: null })).toBe(false);
    // A payee with only a name is fine — it is created when the change is sent.
    expect(endsReady('withdrawal', { ...expense, destinationId: null })).toBe(true);
    expect(
      endsReady('withdrawal', { ...expense, destinationId: null, destinationName: null }),
    ).toBe(false);
  });

  it('a transfer needs both of the accounts, and two different ones', () => {
    expect(endsReady('transfer', transfer)).toBe(true);
    expect(endsReady('transfer', { ...transfer, destinationId: null })).toBe(false);
    expect(endsReady('transfer', { ...transfer, destinationId: 'card' })).toBe(false);
  });

  it('what a rewire leaves unfilled is exactly what it refuses', () => {
    const next = rewireForType('withdrawal', 'transfer', expense);
    expect(
      endsReady('transfer', {
        sourceId: next.source_id ?? null,
        sourceName: next.source_name ?? null,
        destinationId: next.destination_id ?? null,
        destinationName: next.destination_name ?? null,
      }),
    ).toBe(false);
  });
});
