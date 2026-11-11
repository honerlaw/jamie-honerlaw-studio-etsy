// One page of an offset-paginated Etsy collection, or the failed response.
export type PageResult<T> =
  | { readonly ok: true; readonly count: number; readonly results: readonly T[] }
  | { readonly ok: false; readonly response: Response };

export type PagesResult<T> =
  | { readonly ok: true; readonly items: readonly T[]; readonly truncated: boolean }
  | { readonly ok: false; readonly response: Response };

// Reads pages of `pageSize` until Etsy has no more, `maxItems` are collected, or
// `maxPages` pages were read. Workers Free allows 50 subrequests per invocation, so
// every caller passes a page cap; when the cap stops it early, `truncated` says so. A
// 429 after the first page (Etsy still limiting after retries, or the invocation's
// subrequest budget spent) also ends it as truncated, keeping the pages already read.
export async function fetchPages<T>(
  fetchPage: (offset: number, limit: number) => Promise<PageResult<T>>,
  options: { readonly pageSize: number; readonly maxPages: number; readonly maxItems?: number },
): Promise<PagesResult<T>> {
  const items: T[] = [];
  const maxItems = options.maxItems ?? Number.POSITIVE_INFINITY;
  for (let page = 0; page < options.maxPages; page += 1) {
    const result = await fetchPage(page * options.pageSize, options.pageSize);
    if (!result.ok) {
      return page > 0 && result.response.status === 429
        ? { ok: true, items: items.slice(0, maxItems), truncated: true }
        : result;
    }
    items.push(...result.results);
    const exhausted = result.results.length < options.pageSize || items.length >= result.count;
    if (exhausted || items.length >= maxItems) {
      // Truncated when Etsy has more than was returned: pages left, or items cut by maxItems.
      return { ok: true, items: items.slice(0, maxItems), truncated: !exhausted || items.length > maxItems };
    }
  }
  return { ok: true, items: items.slice(0, maxItems), truncated: true };
}
