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
   * Walk every leave request matching the filters. Transparently chunks the
   * date range into ≤60-day windows because SageHR rejects longer ranges
   * with HTTP 422 ("Days between date range must be less than 65").
   */
  async *listAll(params: Omit<ListLeaveRequestsParams, "page"> = {}): AsyncIterable<LeaveRequest> {
    const { from, to, ...rest } = params;
    const windows = chunkDateRange(from, to, 60);
    for (const window of windows) {
      yield* paginate((p) => this.list({ ...rest, ...window, ...p }), {
        page_size: params.page_size,
      });
    }
  }
}
