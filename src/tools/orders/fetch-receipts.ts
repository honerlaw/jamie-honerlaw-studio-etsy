import type { EtsyClient } from "../../etsy/create-etsy-client";
import { fetchPages, type PagesResult } from "../../etsy/fetch-pages";
import { definedFields } from "../../etsy/defined-fields";
import { RECEIPT_PAGE } from "../../etsy/shapes/receipt";

export interface ReceiptQuery {
  readonly min_created?: number | undefined;
  readonly max_created?: number | undefined;
  readonly was_paid?: boolean | undefined;
  readonly was_shipped?: boolean | undefined;
  readonly was_canceled?: boolean | undefined;
}

// Pages through her receipts (100 per page), newest first, up to a page cap that keeps
// the call under Workers Free's 50 subrequests. `truncated` says when the cap hit.
export async function fetchReceipts(
  etsy: EtsyClient,
  shopId: string,
  query: ReceiptQuery,
  limits: { readonly maxPages: number; readonly maxItems?: number },
): Promise<PagesResult<unknown>> {
  return fetchPages(
    async (offset, limit) => {
      const { data, response } = await etsy.GET("/v3/application/shops/{shop_id}/receipts", {
        params: {
          path: { shop_id: Number(shopId) },
          query: { ...definedFields({ ...query }), limit, offset, sort_on: "created", sort_order: "desc" },
        },
      });
      if (!response.ok) {
        return { ok: false, response };
      }
      const page = RECEIPT_PAGE.safeParse(data);
      return page.success
        ? { ok: true, count: page.data.count, results: page.data.results }
        : { ok: false, response: new Response(null, { status: 502 }) };
    },
    { pageSize: 100, ...limits },
  );
}
