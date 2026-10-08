import { renderHook } from '@testing-library/react-native';
import { useActionableCount } from './useActionableCount';
import { useLiveQuery } from '../db/useLiveQuery';

jest.mock('../providers/DbProvider', () => ({
  useDb: () => ({
    select: () => ({
      from: () => {
        const q: Record<string, unknown> = {};
        q.where = () => q;
        return q;
      },
    }),
  }),
}));
jest.mock('../db/useLiveQuery', () => ({ useLiveQuery: jest.fn(() => ({ data: [] })) }));

describe('useActionableCount', () => {
  beforeEach(() => jest.mocked(useLiveQuery).mockClear());

  it('reads by default and respects enabled=false', async () => {
    await renderHook(() => useActionableCount());
    let enabled = jest.mocked(useLiveQuery).mock.calls.map((c) => c[2]);
    expect(enabled).toHaveLength(2);
    expect(enabled.every((e) => e === true)).toBe(true);

    jest.mocked(useLiveQuery).mockClear();
    await renderHook(() => useActionableCount({ enabled: false }));
    enabled = jest.mocked(useLiveQuery).mock.calls.map((c) => c[2]);
    expect(enabled).toHaveLength(2);
    expect(enabled.every((e) => e === false)).toBe(true);
  });

  it('computes actionable count from items and failed ops', async () => {
    jest
      .mocked(useLiveQuery)
      .mockImplementationOnce(() => ({
        data: [
          { kind: 'manual_entry', state: 'captured' },
          { kind: 'receipt', state: 'parsed' },
          { kind: 'recurring_review', state: 'parsed' },
          { kind: 'manual_entry', state: 'error' },
          { kind: 'manual_entry', state: 'confirmed' }, // not counted
          { kind: 'recurring_review', state: 'synced' }, // not counted
        ] as any,
        error: undefined,
      }))
      .mockImplementationOnce(() => ({
        data: [{ id: 'op1' }] as any,
        error: undefined,
      }));

    const { result } = await renderHook(() => useActionableCount());
    // 1 manual captured + 1 receipt parsed + 1 recurring review parsed + 1 error + 1 failed op = 5
    expect(result.current).toBe(5);
  });
});
