// The Inbox stays mounted under a draft or Capture; while one is open it must not re-read its
// tables for every write the screen on top makes.
import { renderHook } from '@testing-library/react-native';
import { useInboxSections } from './useInboxSections';
import { useLiveQuery } from '../db/useLiveQuery';

jest.mock('../providers/DbProvider', () => ({
  useDb: () => ({
    select: () => ({
      from: () => {
        const q: Record<string, unknown> = {};
        q.where = () => q;
        q.orderBy = () => q;
        return q;
      },
    }),
  }),
}));
jest.mock('../db/useLiveQuery', () => ({ useLiveQuery: jest.fn(() => ({ data: [] })) }));

describe('useInboxSections enabled', () => {
  beforeEach(() => jest.mocked(useLiveQuery).mockClear());

  it('reads by default', async () => {
    await renderHook(() => useInboxSections());
    const enabled = jest.mocked(useLiveQuery).mock.calls.map((c) => c[2]);
    expect(enabled).toHaveLength(4);
    expect(enabled.every((e) => e === true)).toBe(true);
  });

  it('turns all four reads off when disabled', async () => {
    await renderHook(() => useInboxSections({ enabled: false }));
    const enabled = jest.mocked(useLiveQuery).mock.calls.map((c) => c[2]);
    expect(enabled).toHaveLength(4);
    expect(enabled.every((e) => e === false)).toBe(true);
  });
});
