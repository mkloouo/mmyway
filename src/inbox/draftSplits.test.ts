import type { Draft } from './draft';
import { draftToTransactionPayload } from './draft';
import { addSplit, draftAmounts, draftTotal, removeExtraSplit, withAmounts } from './draftSplits';
import { draftReadiness } from './readiness';

const base: Draft = {
  type: 'withdrawal', amount: '100.00', currencyCode: 'PLN', date: '2026-09-28T10:00:00.000Z',
  description: 'Biedronka', sourceId: '1', destinationName: 'Biedronka', destinationId: '50', isNewPayee: false,
  categoryName: 'Groceries',
};

describe('draft splits', () => {
  it('adds a split that takes its amount from split 1 and tracks the old total', () => {
    const next = { ...base, ...addSplit(base, ['70.00'], '30.00') };
    expect(draftAmounts(next)).toEqual(['70.00', '30.00']);
    expect(next.total).toBe('100.00');
    expect(next.groupTitle).toBe('Biedronka');
    expect(next.extraSplits?.[0]).toMatchObject({ payeeName: 'Biedronka', payeeId: '50', isNewPayee: false });
    expect(draftReadiness(next).ready).toBe(true);
  });

  it('is not ready while the splits and the total disagree', () => {
    const split = { ...base, ...addSplit(base, ['70.00'], '30.00') };
    const off = { ...split, ...withAmounts(split, ['60.00', '30.00']) };
    expect(draftReadiness(off).missing).toContain('split total');
  });

  it('sends every split with a group title', () => {
    const split = { ...base, ...addSplit(base, ['70.00'], '30.00') };
    const payload = draftToTransactionPayload('client-1', split);
    expect(payload.groupTitle).toBe('Biedronka');
    expect(payload.splits.map((s) => s.amount)).toEqual(['70.00', '30.00']);
    expect(payload.splits[1]).toMatchObject({ source_id: '1', destination_id: '50', date: base.date });
  });

  it('turns back into a plain entry holding the total when the last extra split goes', () => {
    const split = { ...base, ...addSplit(base, ['70.00'], '30.00') };
    const plain = { ...split, ...removeExtraSplit(split, 1) };
    expect(plain.extraSplits).toBeUndefined();
    expect(plain.amount).toBe('100.00');
    expect(draftTotal(plain)).toBe('100.00');
    expect(draftToTransactionPayload('c', plain).splits).toHaveLength(1);
  });
});
