import type { SageHRClient } from "../client.js";
import type { Absence } from "../schemas/absence.js";
import type { LeaveRequest } from "../schemas/leave-request.js";

export interface ListAbsencesParams {
  /** Required — ISO date YYYY-MM-DD. */
  from: string;
  /** Required — ISO date YYYY-MM-DD. */
  to: string;
  /** Optional — only include employees in this team. */
  team_id?: number | string;
}

/**
 * Out-of-office (absences) — derived, not native.
 *
 * SageHR's /leave-management/out-of-office endpoint exists in some tenants
 * but returns 404 on others (aleph1, May 2026). To get reliable absence
 * data everywhere, we derive it from leave-requests: query all requests
 * overlapping the `from`..`to` window, keep the approved ones, and treat
 * them as out-of-office records.
 *
 * - Date range can span any length — the underlying `listAll` auto-chunks.
 * - `team_id` filter (when provided) joins via /teams to find that team's
 *   employee ids, then filters the absence list to those members.
 * - Records carry the same fields as a leave-request, mapped to the
 *   Absence shape: { employee_id, start_date, end_date, policy_id,
 *   status, is_part_of_day, hours, ... }.
 */
export class AbsencesResource {
  constructor(private readonly client: SageHRClient) {}

  async list(params: ListAbsencesParams): Promise<Absence[]> {
    if (!params.from || !params.to) {
      throw new Error("AbsencesResource.list: `from` and `to` are required");
    }

    const teamEmployeeIds = await this.teamEmployeeIdSet(params.team_id);

    const out: Absence[] = [];
    for await (const req of this.client.leaveRequests.listAll({
      from: params.from,
      to: params.to,
    })) {
      if (!isApproved(req)) continue;
      if (teamEmployeeIds && !teamEmployeeIds.has(String(req.employee_id))) continue;
      out.push(toAbsence(req));
    }
    return out;
  }

  private async teamEmployeeIdSet(
    teamId: number | string | undefined,
  ): Promise<Set<string> | null> {
    if (teamId === undefined) return null;
    const teams = await this.client.teams.list();
    const want = String(teamId);
    const team = teams.find((t) => String(t.id) === want);
    if (!team || !team.employee_ids) return new Set(); // unknown team — filter to nothing
    return new Set(team.employee_ids.map((id) => String(id)));
  }
}

function isApproved(req: LeaveRequest): boolean {
  const code = (req.status_code ?? "").toLowerCase();
  if (code === "approved") return true;
  const human = (req.status ?? "").toLowerCase();
  return human.includes("approve");
}

function toAbsence(req: LeaveRequest): Absence {
  return {
    id: req.id,
    employee_id: req.employee_id,
    start_date: req.start_date ?? null,
    end_date: req.end_date ?? null,
    policy_id: req.policy_id ?? null,
    policy: null,
    status: req.status_code ?? req.status ?? null,
    is_part_of_day: req.is_part_of_day ?? null,
    hours: req.hours ?? null,
  } as Absence;
}
