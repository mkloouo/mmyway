// Unified pagination helper for Firefly III collection endpoints.
// FF3 paginates every collection endpoint (default 50 or 100), and responses carry either a
// `meta.pagination` object or end when `data.length < limit`.
// Probed against version-6.7.6: `/v1/accounts` and `/v1/search/transactions` paginate properly
// (a page past the last returns `data: []` with the real `total_pages`), but
// `/v1/search/accounts` ignores `limit` and `page` entirely — it answers every match in one go
// and reports `total_pages: 1`, so page 99 returns page 1. Honouring `total_pages` is what keeps
// that endpoint from looping forever on the same page.
import type { FF3Client } from './client';

export interface PaginationOptions<T> {
  pageSize?: number;
  /** Stop early if this predicate returns true for any item in a page. */
  stopWhen?: (item: T) => boolean;
  /** Max pages to fetch (default: unlimited). */
  maxPages?: number;
}

export async function fetchAllPages<T>(
  client: FF3Client,
  path: string,
  options: PaginationOptions<T> = {},
): Promise<T[]> {
  const { pageSize = 100, stopWhen, maxPages = Infinity } = options;
  const separator = path.includes('?') ? '&' : '?';
  const out: T[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const pageUrl = `${path}${separator}limit=${pageSize}&page=${page}`;
    const response = await client.request<{
      data: T[];
      meta?: { pagination?: { total_pages?: number; current_page?: number } };
    }>(pageUrl);

    const items = response?.data ?? [];
    for (const item of items) {
      out.push(item);
      if (stopWhen && stopWhen(item)) return out;
    }

    const totalPages = response?.meta?.pagination?.total_pages;
    if (totalPages !== undefined && page >= totalPages) break;
    if (items.length < pageSize) break;
  }

  return out;
}
