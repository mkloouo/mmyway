import { fetchAllPages } from './paginate';
import type { FF3Client } from './client';

describe('fetchAllPages', () => {
  it('fetches a single page when data length is less than pageSize', async () => {
    const request = jest.fn().mockResolvedValue({
      data: [{ id: '1' }, { id: '2' }],
    });
    const client = { request } as unknown as FF3Client;

    const result = await fetchAllPages(client, '/v1/accounts', { pageSize: 10 });
    expect(result).toEqual([{ id: '1' }, { id: '2' }]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('/v1/accounts?limit=10&page=1');
  });

  it('pages through multiple pages until the last page', async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce({
        data: [{ id: '1' }, { id: '2' }],
      })
      .mockResolvedValueOnce({
        data: [{ id: '3' }],
      });
    const client = { request } as unknown as FF3Client;

    const result = await fetchAllPages(client, '/v1/categories?foo=bar', { pageSize: 2 });
    expect(result).toEqual([{ id: '1' }, { id: '2' }, { id: '3' }]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenNthCalledWith(1, '/v1/categories?foo=bar&limit=2&page=1');
    expect(request).toHaveBeenNthCalledWith(2, '/v1/categories?foo=bar&limit=2&page=2');
  });

  it('stops early when stopWhen matches an item', async () => {
    const request = jest.fn().mockResolvedValueOnce({
      data: [
        { id: '1', name: 'Alpha' },
        { id: '2', name: 'Target' },
      ],
    });
    const client = { request } as unknown as FF3Client;

    const result = await fetchAllPages<{ id: string; name: string }>(client, '/v1/rule-groups', {
      pageSize: 2,
      stopWhen: (g) => g.name === 'Target',
    });
    expect(result).toHaveLength(2);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('respects meta.pagination.total_pages when present', async () => {
    const request = jest.fn().mockResolvedValueOnce({
      data: [{ id: '1' }, { id: '2' }],
      meta: { pagination: { total_pages: 1, current_page: 1 } },
    });
    const client = { request } as unknown as FF3Client;

    const result = await fetchAllPages(client, '/v1/transactions', { pageSize: 2 });
    expect(result).toHaveLength(2);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
