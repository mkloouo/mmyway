import { searchTransactions } from './remoteSearch';
import type { FF3Client } from '../api/ff3/client';

describe('searchTransactions', () => {
  it('calls service.transactions.search with pagination', async () => {
    const requestedUrls: string[] = [];
    const client: FF3Client = {
      request: async <T>(url: string) => {
        requestedUrls.push(url);
        return {
          data: [
            {
              id: '10',
              attributes: {
                transactions: [
                  {
                    transaction_journal_id: 'j10',
                    type: 'withdrawal',
                    date: '2026-03-01',
                    amount: '42.00',
                    description: 'Test Search',
                    updated_at: '2026-03-01T00:00:00Z',
                  },
                ],
              },
            },
          ],
          meta: { pagination: { current_page: 1, total_pages: 1, total: 1 } },
        } as T;
      },
    };

    const results = await searchTransactions(client, 'Lidl');
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe('10');
    expect(requestedUrls[0]).toContain('/v1/search/transactions?query=Lidl&limit=50&page=1');
  });
});
