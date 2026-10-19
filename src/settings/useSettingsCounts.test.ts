import { renderHook } from '@testing-library/react-native';
import { useSettingsCounts } from './useSettingsCounts';
import { useLiveQuery } from '../db/useLiveQuery';

jest.mock('../providers/DbProvider', () => ({
  useDb: () => ({
    select: () => {
      const q: Record<string, unknown> = {};
      q.from = () => q;
      q.where = () => q;
      return q;
    },
  }),
}));
jest.mock('../db/useLiveQuery', () => ({
  useLiveQuery: jest.fn(),
}));

describe('useSettingsCounts', () => {
  it('returns zeros when tables are empty', async () => {
    jest.mocked(useLiveQuery).mockReturnValue({ data: [], error: undefined });
    const { result } = await renderHook(() => useSettingsCounts());
    expect(result.current).toEqual({
      aliasesCount: 0,
      liabilitiesCount: 0,
      rulesCount: 0,
      subscriptionsCount: 0,
    });
  });

  it('counts active liabilities, aliases, rules and subscriptions correctly', async () => {
    jest
      .mocked(useLiveQuery)
      .mockImplementationOnce(() => ({
        data: [{ id: '1', alias: 'BIEDRONKA', payeeName: 'Biedronka' }] as any,
        error: undefined,
      }))
      .mockImplementationOnce(() => ({
        data: [
          { id: 'l1', name: 'Loan 1', active: true, type: 'liability' },
          { id: 'l2', name: 'Loan 2', active: false, type: 'liability' },
        ] as any,
        error: undefined,
      }))
      .mockImplementationOnce(() => ({
        data: [
          { id: 'r1', kind: 'rule', name: 'Rule 1' },
          { id: 'r2', kind: 'rule', name: 'Rule 2' },
          { id: 'b1', kind: 'bill', name: 'Bill 1' },
          { id: 'rec1', kind: 'recurrence', name: 'Recurrence 1' },
        ] as any,
        error: undefined,
      }));

    const { result } = await renderHook(() => useSettingsCounts());
    expect(result.current).toEqual({
      aliasesCount: 1,
      liabilitiesCount: 1,
      rulesCount: 2,
      subscriptionsCount: 2,
    });
  });
});
