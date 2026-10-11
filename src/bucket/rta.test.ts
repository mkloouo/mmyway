import { readyToAssign } from './rta';

const empty = { cash: [], envelopeAvailable: [], fundsSaved: [], billsDue: [], decimalPlaces: 2 };

describe('readyToAssign', () => {
  it('is cash minus everything already allocated', () => {
    expect(
      readyToAssign({
        ...empty,
        cash: ['1000.00', '250.50'],
        envelopeAvailable: ['200.00', '50.50'],
        fundsSaved: ['300.00'],
        billsDue: ['120.00'],
      }),
    ).toEqual({
      cash: '1250.50',
      envelopes: '250.50',
      funds: '300.00',
      bills: '120.00',
      allocated: '670.50',
      readyToAssign: '580.00',
    });
  });

  it('does not count an overspent envelope twice', () => {
    // The 45 overspend has already left the account, so the negative remainder is dropped:
    // counting it again would report 45 more as ready to assign than there is.
    const over = readyToAssign({ ...empty, cash: ['100.00'], envelopeAvailable: ['-45.00'] });
    expect(over.envelopes).toBe('0.00');
    expect(over.readyToAssign).toBe('100.00');
  });

  it('goes negative when more is allocated than the accounts hold', () => {
    expect(readyToAssign({ ...empty, cash: ['50.00'], fundsSaved: ['80.00'] }).readyToAssign).toBe(
      '-30.00',
    );
  });

  it('works in a currency with no decimal places', () => {
    expect(
      readyToAssign({
        cash: ['100000'],
        envelopeAvailable: ['25000'],
        fundsSaved: [],
        billsDue: ['5000'],
        decimalPlaces: 0,
      }),
    ).toMatchObject({ allocated: '30000', readyToAssign: '70000' });
  });

  it('is zero with nothing at all', () => {
    expect(readyToAssign(empty).readyToAssign).toBe('0.00');
  });
});
