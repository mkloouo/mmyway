import {
  getUsedAccountIdsThisYear,
  filterAccountsUsedThisYear,
  type TransactionAccountRef,
} from './usedAccounts';

describe('usedAccounts', () => {
  describe('getUsedAccountIdsThisYear', () => {
    it('returns empty set when transactions are empty', () => {
      expect(getUsedAccountIdsThisYear([], 2026)).toEqual(new Set());
    });

    it('collects source and destination IDs only for the target year', () => {
      const txs: TransactionAccountRef[] = [
        { date: '2026-01-15T10:00:00Z', sourceId: 'src-1', destinationId: 'dst-1' },
        { date: '2026-08-20', sourceId: 'src-2', destinationId: null },
        { date: '2026-12-31T23:59:59Z', sourceId: null, destinationId: 'dst-2' },
        // Previous year: should be ignored
        { date: '2025-12-31T23:59:59Z', sourceId: 'src-old', destinationId: 'dst-old' },
        // Next year: should be ignored
        { date: '2027-01-01T00:00:00Z', sourceId: 'src-future', destinationId: 'dst-future' },
      ];

      const used = getUsedAccountIdsThisYear(txs, 2026);
      expect(used).toEqual(new Set(['src-1', 'dst-1', 'src-2', 'dst-2']));
    });

    it('defaults to current calendar year when year argument is omitted', () => {
      const currentYear = new Date().getFullYear();
      const txs: TransactionAccountRef[] = [
        { date: `${currentYear}-05-01`, sourceId: 'acc-current', destinationId: null },
        { date: `${currentYear - 1}-05-01`, sourceId: 'acc-last-year', destinationId: null },
      ];

      const used = getUsedAccountIdsThisYear(txs);
      expect(used.has('acc-current')).toBe(true);
      expect(used.has('acc-last-year')).toBe(false);
    });
  });

  describe('filterAccountsUsedThisYear', () => {
    it('filters accounts matching used IDs preserving order', () => {
      const accounts = [
        { id: 'a1', name: 'Aldi' },
        { id: 'a2', name: 'Biedronka' },
        { id: 'a3', name: 'Carrefour' },
      ];
      const usedIds = new Set(['a1', 'a3']);

      expect(filterAccountsUsedThisYear(accounts, usedIds)).toEqual([
        { id: 'a1', name: 'Aldi' },
        { id: 'a3', name: 'Carrefour' },
      ]);
    });

    it('returns empty array when none match', () => {
      const accounts = [{ id: 'a1', name: 'Aldi' }];
      expect(filterAccountsUsedThisYear(accounts, new Set(['other']))).toEqual([]);
    });
  });
});
