import { z } from "zod";
import type { SageHRClient } from "../client.js";
import {
  LeavePolicySchema,
  LeaveBalanceSchema,
  type LeavePolicy,
  type LeaveBalance,
} from "../schemas/policy.js";

const PATH_POLICIES = "/leave-management/policies";
// SageHR's "Employee time off balances": GET /employees/{id}/leave-management/balances
// → { data: [{ policy_id, used, available }] }. (The shorter /employees/{id}/leave-balances
// path 404s — it does not exist in the API.)
const PATH_BALANCES = (employeeId: number | string) =>
  `/employees/${encodeURIComponent(String(employeeId))}/leave-management/balances`;

const PolicyListSchema = z
  .object({
    data: z.array(LeavePolicySchema),
  })
  .passthrough();

const BalanceListSchema = z
  .object({
    data: z.array(LeaveBalanceSchema),
  })
  .passthrough();

export class PoliciesResource {
  constructor(private readonly client: SageHRClient) {}

  async list(): Promise<LeavePolicy[]> {
    const raw = await this.client.request<unknown>(PATH_POLICIES);
    return PolicyListSchema.parse(raw).data;
  }

  async balancesFor(employeeId: number | string): Promise<LeaveBalance[]> {
    const raw = await this.client.request<unknown>(PATH_BALANCES(employeeId));
    return BalanceListSchema.parse(raw).data;
  }
}
