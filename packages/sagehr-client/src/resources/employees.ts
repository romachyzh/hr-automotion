import type { SageHRClient } from "../client.js";
import { EmployeeSchema, type Employee } from "../schemas/employee.js";
import {
  PagedResponseSchema,
  paginate,
  type PageParams,
  type PagedResponse,
} from "../pagination.js";

/**
 * Endpoint paths: confirmed conceptually against SageHR Apiary docs
 * (https://sagehr.docs.apiary.io/). If exact path differs in your tenant,
 * update PATH_LIST / PATH_GET — that's the only place these strings live.
 */
const PATH_LIST = "/employees";
const PATH_GET = (id: number | string) => `/employees/${encodeURIComponent(String(id))}`;

export interface ListEmployeesParams extends PageParams {
  team_id?: number | string;
  /** "active" | "inactive" — SageHR accepts a status filter on this collection. */
  status?: string;
}

export class EmployeesResource {
  constructor(private readonly client: SageHRClient) {}

  async list(params: ListEmployeesParams = {}): Promise<PagedResponse<Employee>> {
    const raw = await this.client.request<unknown>(PATH_LIST, {
      query: {
        page: params.page,
        page_size: params.page_size,
        team_id: params.team_id,
        status: params.status,
      },
    });
    return PagedResponseSchema(EmployeeSchema).parse(raw);
  }

  async get(id: number | string): Promise<Employee> {
    const raw = await this.client.request<unknown>(PATH_GET(id));
    // SageHR's single-resource responses are usually { data: {...} }
    const wrapped = (raw as { data?: unknown }).data ?? raw;
    return EmployeeSchema.parse(wrapped);
  }

  listAll(params: Omit<ListEmployeesParams, "page"> = {}): AsyncIterable<Employee> {
    return paginate((p) => this.list({ ...params, ...p }), {
      page_size: params.page_size,
    });
  }
}
