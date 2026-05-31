export { SageHRClient } from "./client.js";
export type { SageHRClientOptions } from "./client.js";

export {
  SageHRError,
  SageHRAuthError,
  SageHRNotFoundError,
  SageHRRateLimitError,
} from "./errors.js";

export type { Employee } from "./schemas/employee.js";
export type { LeaveRequest, LeaveDaysOptions } from "./schemas/leave-request.js";
export { computeLeaveDays } from "./schemas/leave-request.js";
export type { Absence } from "./schemas/absence.js";
export type { Team, Position } from "./schemas/team.js";
export type { LeavePolicy, LeaveBalance } from "./schemas/policy.js";

export type { PageParams, PagedResponse } from "./pagination.js";
export type { ListEmployeesParams } from "./resources/employees.js";
export type { ListLeaveRequestsParams } from "./resources/leave-requests.js";
export type { ListAbsencesParams } from "./resources/absences.js";
