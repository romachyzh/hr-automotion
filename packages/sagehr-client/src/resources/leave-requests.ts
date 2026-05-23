import type { SageHRClient } from "../client.js";
import { LeaveRequestSchema, type LeaveRequest } from "../schemas/leave-request.js";
import {
  PagedResponseSchema,
  chunkDateRange,
  paginate,
  type PageParams,
  type PagedResponse,
} from "../pagination.js";

const PATH_LIST = "/leave-management/requests";
const PATH_GET = (id: number | string) =>
  `/leave-management/requests/${encodeURIComponent(String(id))}`;

export interface ListLeaveRequestsParams extends PageParams {
  employee_id?: number | string;
  /** ISO date YYYY-MM-DD */
  from?: string;
  /** ISO date YYYY-MM-DD */
  to?: string;
  /** "approved" | "pending" | "rejected" — strings vary by tenant. */
  status?: string;
}

export class LeaveRequestsResource {
  constructor(private readonly client: SageHRClient) {}

  async list(params: ListLeaveRequestsParams = {}): Promise<PagedResponse<LeaveRequest>> {
    const raw = await this.client.request<unknown>(PATH_LIST, {
      query: {
        page: params.page,
        page_size: params.page_size,
        employee_id: params.employee_id,
        from: params.from,
        to: params.to,
        status: params.status,
      },
    });
    return PagedResponseSchema(LeaveRequestSchema).parse(raw);
  }

  async get(id: number | string): Promise<LeaveRequest> {
    const raw = await this.client.request<unknown>(PATH_GET(id));
    const wrapped = (raw as { data?: unknown }).data ?? raw;
    return LeaveRequestSchema.parse(wrapped);
  }

  /**
   * Walk every leave request matching the filters.
   *
   * Two pieces of vendor-side weirdness are handled here:
   *
   *   1. Date-range cap. SageHR rejects `from`..`to` ranges of ≥65 days
   *      with HTTP 422. We split into ≤60-day windows transparently.
   *
   *   2. employee_id filter is silently ignored. SageHR's
   *      `/leave-management/requests` endpoint returns tenant-wide results
   *      regardless of the `employee_id` query param. We send it anyway
   *      (in case a future version honours it) AND filter client-side as
   *      a guarantee.
   */
  async *listAll(params: Omit<ListLeaveRequestsParams, "page"> = {}): AsyncIterable<LeaveRequest> {
    const { from, to, employee_id, ...rest } = params;
    const employeeIdStr = employee_id !== undefined ? String(employee_id) : null;
    const windows = chunkDateRange(from, to, 60);
    for (const window of windows) {
      for await (const req of paginate(
        (p) => this.list({ ...rest, employee_id, ...window, ...p }),
        { page_size: params.page_size },
      )) {
        if (employeeIdStr !== null && String(req.employee_id) !== employeeIdStr) {
          continue;
        }
        yield req;
      }
    }
  }
}
