import { fundShortfall, fundsFrom } from './funds';
import { bucketKey, type BucketObject } from './objects';

function piggy(id: string, attributes: Record<string, unknown>): BucketObject {
  return {
    key: bucketKey('piggy', id),
    kind: 'piggy',
    ff3Id: id,
    periodStart: null,
    attributes,
  };
}

describe('fundsFrom', () => {
  it('reads a piggy bank, its target and the account its money sits in', () => {
    expect(
      fundsFrom([
        piggy('7', {
          name: 'New laptop',
          current_amount: '300.00',
          target_amount: '4000.00',
          target_date: '2027-02-01T00:00:00+01:00',
          percentage: 7,
          currency_code: 'PLN',
          object_group_title: 'Savings',
          updated_at: 'u1',
          accounts: [{ id: 5, name: 'Revolut', current_amount: '300.00' }],
        }),
      ]),
    ).toEqual([
      {
        id: '7',
        name: 'New laptop',
        saved: '300.00',
        target: '4000.00',
        targetDate: '2027-02-01',
        percentage: 7,
        accountId: '5',
        accountName: 'Revolut',
        currencyCode: 'PLN',
        groupTitle: 'Savings',
        updatedAt: 'u1',
      },
    ]);
  });

  it("treats FF3's target_amount of 0 as no target at all, not as a target of zero", () => {
    // FF3 stores "open-ended" as 0 and switches both of its clamps off for it (plan §0).
    const [open] = fundsFrom([
      piggy('1', { name: 'Rainy day', current_amount: '50.00', target_amount: '0' }),
    ]);
    expect(open!.target).toBeNull();
    expect(fundShortfall(open!)).toBeNull();
  });

  it('leaves out rows of other kinds and sorts by name', () => {
    const funds = fundsFrom([
      piggy('1', { name: 'Zebra', current_amount: '0' }),
      piggy('2', { name: 'Aardvark', current_amount: '0' }),
      { ...piggy('3', { amount: '5' }), kind: 'budget_limit' as const },
    ]);
    expect(funds.map((f) => f.name)).toEqual(['Aardvark', 'Zebra']);
  });

  it('copes with a piggy bank that has no linked account', () => {
    const [fund] = fundsFrom([piggy('1', { name: 'Detached', current_amount: '10.00' })]);
    expect(fund).toMatchObject({ accountId: null, accountName: null, saved: '10.00' });
  });
});

describe('fundShortfall', () => {
  it('is what is still missing, zero once the target is reached, null when there is none', () => {
    const [fund] = fundsFrom([
      piggy('1', { name: 'F', current_amount: '300.00', target_amount: '4000.00' }),
    ]);
    expect(fundShortfall(fund!)).toBe('3700.00');

    const [full] = fundsFrom([
      piggy('2', { name: 'F', current_amount: '4000.00', target_amount: '4000.00' }),
    ]);
    expect(fundShortfall(full!)).toBe('0');

    const [over] = fundsFrom([
      piggy('3', { name: 'F', current_amount: '4500.00', target_amount: '4000.00' }),
    ]);
    expect(fundShortfall(over!)).toBe('0');
  });
});
