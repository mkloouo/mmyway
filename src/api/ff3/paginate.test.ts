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

  // /v1/search/accounts ignores limit and page: probing version-6.7.6 with limit=1 returned all
  // 11 matches, per_page 11, total_pages 1 — and page=99 returned page 1 again. Without the
  // total_pages break this endpoint would be fetched forever.
  it('stops after one request on an endpoint that ignores limit and page', async () => {
    const request = jest.fn().mockResolvedValue({
      data: [{ id: '1' }, { id: '2' }, { id: '3' }],
      meta: { pagination: { total: 3, count: 3, per_page: 3, current_page: 1, total_pages: 1 } },
    });
    const client = { request } as unknown as FF3Client;

    const result = await fetchAllPages(client, '/v1/search/accounts?query=a', { pageSize: 1 });
    expect(result).toHaveLength(3);
    expect(request).toHaveBeenCalledTimes(1);
  });

  // The shape a properly paginated endpoint gives past its last page.
  it('stops on an empty page that still reports more total_pages', async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce({
        data: [{ id: '1' }, { id: '2' }],
        meta: { pagination: { total: 2, count: 2, per_page: 2, current_page: 1, total_pages: 4 } },
      })
      .mockResolvedValueOnce({
        data: [],
        meta: { pagination: { total: 2, count: 0, per_page: 2, current_page: 2, total_pages: 4 } },
      });
    const client = { request } as unknown as FF3Client;

    const result = await fetchAllPages(client, '/v1/accounts?type=expense', { pageSize: 2 });
    expect(result).toEqual([{ id: '1' }, { id: '2' }]);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
