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

/**
 * Split an inclusive ISO date range into windows of at most `maxDays` each.
 *
 * SageHR's `/leave-management/requests` and `/leave-management/out-of-office`
 * endpoints reject any range longer than 65 days with HTTP 422
 * `{"error_code":"bad_parameters","errors":["Days between date range must be less than 65"]}`.
 * Using `maxDays = 60` gives a small safety margin.
 *
 * If either bound is missing, returns a single window with whatever was given.
 * If `to` is on or before `from`, returns a single window verbatim.
 */
export function chunkDateRange(
  from: string | undefined,
  to: string | undefined,
  maxDays = 60,
): Array<{ from?: string; to?: string }> {
  if (!from || !to) return [{ from, to }];

  const startMs = Date.parse(`${from}T00:00:00Z`);
  const endMs = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return [{ from, to }];
  }

  const dayMs = 86_400_000;
  const totalDays = Math.round((endMs - startMs) / dayMs);
  if (totalDays < maxDays) return [{ from, to }];

  const windows: Array<{ from?: string; to?: string }> = [];
  let cursor = startMs;
  while (cursor <= endMs) {
    const windowEnd = Math.min(cursor + (maxDays - 1) * dayMs, endMs);
    windows.push({ from: toIsoDate(cursor), to: toIsoDate(windowEnd) });
    cursor = windowEnd + dayMs;
  }
  return windows;
}

function toIsoDate(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
