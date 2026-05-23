import { z } from "zod";

/**
 * SageHR's published responses are typically shaped like:
 *   { data: T[], meta: { total: number, current_page: number, total_pages: number } }
 * The exact field names may need adjustment when verified against the live API.
 */
export const PagedResponseSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    data: z.array(item),
    meta: z
      .object({
        total: z.number().int().nonnegative().optional(),
        current_page: z.number().int().positive().optional(),
        total_pages: z.number().int().nonnegative().optional(),
      })
      .partial()
      .optional(),
  });

export type PagedResponse<T> = {
  data: T[];
  meta?: { total?: number; current_page?: number; total_pages?: number };
};

export interface PageParams {
  page?: number;
  /** Some endpoints use `per_page`, some `page_size`. We pass both; SageHR ignores the unknown one. */
  page_size?: number;
}

/** Walk an endpoint's pages until exhausted, yielding each item. */
export async function* paginate<T>(
  fetchPage: (params: PageParams) => Promise<PagedResponse<T>>,
  params: PageParams = {},
): AsyncIterable<T> {
  let page = params.page ?? 1;
  const pageSize = params.page_size ?? 100;
  while (true) {
    const res = await fetchPage({ page, page_size: pageSize });
    for (const item of res.data) yield item;
    const totalPages = res.meta?.total_pages;
    if (totalPages !== undefined) {
      if (page >= totalPages) return;
    } else if (res.data.length < pageSize) {
      return;
    }
    page++;
  }
}
