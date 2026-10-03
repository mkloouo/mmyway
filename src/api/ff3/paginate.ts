// Unified pagination helper for Firefly III collection endpoints.
// FF3 paginates every collection endpoint (default 50 or 100), and responses carry either a
// `meta.pagination` object or end when `data.length < limit`. This helper guarantees complete
// fetches across all pages with optional early termination.
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
