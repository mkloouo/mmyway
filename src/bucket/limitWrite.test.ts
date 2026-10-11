import { limitWrite, type LimitWriteInput } from './limitWrite';

const base: LimitWriteInput = {
  budgetId: '7',
  wanted: '500.00',
  limitId: null,
  currentAmount: null,
  periodStart: '2026-10-01',
  periodEnd: '2026-10-31',
  currencyCode: 'PLN',
};

describe('limitWrite', () => {
  it('creates the limit when Firefly III has none for the period', () => {
    expect(limitWrite(base)).toEqual({
      method: 'POST',
      path: '/v1/budgets/7/limits',
      body: {
        start: '2026-10-01',
        end: '2026-10-31',
        amount: '500.00',
        currency_code: 'PLN',
      },
    });
  });

  it('updates an existing limit with the amount alone', () => {
    expect(limitWrite({ ...base, limitId: '31', currentAmount: '400.00' })).toEqual({
      method: 'PUT',
      path: '/v1/budgets/7/limits/31',
      body: { amount: '500.00' },
    });
  });

  it('sends nothing when the limit already holds that amount, however it is written', () => {
    expect(limitWrite({ ...base, limitId: '31', currentAmount: '500.00' }).method).toBe('none');
    // FF3 answers amounts as `500.000000000000`; that is the same assignment.
    expect(limitWrite({ ...base, limitId: '31', currentAmount: '500.000000000000' }).method).toBe(
      'none',
    );
  });

  it('deletes the limit instead of writing a zero, which FF3 refuses', () => {
    expect(limitWrite({ ...base, wanted: '0', limitId: '31', currentAmount: '500.00' })).toEqual({
      method: 'DELETE',
      path: '/v1/budgets/7/limits/31',
    });
    expect(limitWrite({ ...base, wanted: '0.00', limitId: '31', currentAmount: '1' }).method).toBe(
      'DELETE',
    );
  });

  it('does nothing when zero is asked for and there is no limit to remove', () => {
    expect(limitWrite({ ...base, wanted: '0' }).method).toBe('none');
  });

  it('treats a negative amount as zero rather than sending it', () => {
    expect(limitWrite({ ...base, wanted: '-10.00' }).method).toBe('none');
    expect(limitWrite({ ...base, wanted: '-10.00', limitId: '31' }).method).toBe('DELETE');
  });

  it('updates a limit whose current amount is not known', () => {
    // The cache may not have it (a limit created in FF3's web UI since the last pull): send the PUT
    // rather than guess that it already matches.
    expect(limitWrite({ ...base, limitId: '31', currentAmount: null }).method).toBe('PUT');
  });
});
