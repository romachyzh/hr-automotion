/**
 * Shared leave-aggregation helpers.
 *
 * Extracted from the MCP leave-summary tools so the same logic backs both the
 * `sagehr_leave_summary_*` tools and the dashboard data API — one
 * implementation, no divergence. The primitive day-count derivation lives in
 * the client (`computeLeaveDays`); this module bundles it into policy-level
 * and status-level rollups plus policy-name enrichment.
 */
import { computeLeaveDays } from "@hr-automotion/sagehr-client";
import type { SageHRClient, LeaveRequest, LeaveDaysOptions } from "@hr-automotion/sagehr-client";

export type StatusKey = "approved" | "pending" | "rejected" | "cancelled" | "other";

/**
 * Pick a canonical status bucket. SageHR ships both `status_code`
 * (machine-readable: "approved" / "declined" / "pending" / "cancelled")
 * and `status` (human-readable, capitalisation varies). Prefer the code
 * field, fall back to fuzzy-matching the human string.
 */
export function normaliseStatus(req: LeaveRequest): StatusKey {
  const code = (req.status_code ?? "").toLowerCase();
  if (code === "approved") return "approved";
  if (code === "pending" || code === "awaiting" || code === "awaiting_approval") return "pending";
  if (code === "rejected" || code === "declined") return "rejected";
  if (code === "cancelled" || code === "canceled") return "cancelled";

  const human = (req.status ?? "").toLowerCase();
  if (human.includes("approve")) return "approved";
  if (human.includes("pend") || human.includes("await")) return "pending";
  if (human.includes("reject") || human.includes("declin")) return "rejected";
  if (human.includes("cancel")) return "cancelled";
  return "other";
}

export interface PolicyBucket {
  policy_id: string | number | null;
  request_count: number;
  days_total: number;
  hours_total: number;
  by_status: Record<StatusKey, { request_count: number; days: number; hours: number }>;
}

export function emptyStatusBuckets(): PolicyBucket["by_status"] {
  return {
    approved: { request_count: 0, days: 0, hours: 0 },
    pending: { request_count: 0, days: 0, hours: 0 },
    rejected: { request_count: 0, days: 0, hours: 0 },
    cancelled: { request_count: 0, days: 0, hours: 0 },
    other: { request_count: 0, days: 0, hours: 0 },
  };
}

/** Aggregate a list of leave requests into a policy-level breakdown. */
export function aggregateByPolicy(
  requests: LeaveRequest[],
  dayOpts: LeaveDaysOptions = {},
): {
  by_policy: PolicyBucket[];
  totals: { request_count: number; days_total: number; hours_total: number };
} {
  const buckets = new Map<string, PolicyBucket>();
  let totalDays = 0;
  let totalHours = 0;

  for (const req of requests) {
    const key = String(req.policy_id ?? "unknown");
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        policy_id: req.policy_id ?? null,
        request_count: 0,
        days_total: 0,
        hours_total: 0,
        by_status: emptyStatusBuckets(),
      };
      buckets.set(key, bucket);
    }
    // Days aren't pre-computed on SageHR's response — derive from dates and
    // part-of-day flags. Hours are returned directly when present.
    const days = computeLeaveDays(req, dayOpts);
    const hours = Number(req.hours ?? 0) || 0;
    bucket.request_count += 1;
    bucket.days_total = round2(bucket.days_total + days);
    bucket.hours_total = round2(bucket.hours_total + hours);
    totalDays += days;
    totalHours += hours;

    const statusKey = normaliseStatus(req);
    const statusBucket = bucket.by_status[statusKey];
    statusBucket.request_count += 1;
    statusBucket.days = round2(statusBucket.days + days);
    statusBucket.hours = round2(statusBucket.hours + hours);
  }

  const by_policy = [...buckets.values()].sort((a, b) => b.days_total - a.days_total);
  return {
    by_policy,
    totals: {
      request_count: requests.length,
      days_total: round2(totalDays),
      hours_total: round2(totalHours),
    },
  };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Summarise how day totals were counted, so callers can interpret the figures. */
export function describeDayCounting(opts: LeaveDaysOptions): {
  basis: "business_days" | "calendar_days";
  weekends_counted: boolean;
  holidays_excluded: number;
} {
  const countWeekends = opts.countWeekends ?? false;
  const holidaysExcluded = opts.holidays ? [...opts.holidays].length : 0;
  return {
    basis: countWeekends ? "calendar_days" : "business_days",
    weekends_counted: countWeekends,
    holidays_excluded: holidaysExcluded,
  };
}

/**
 * SageHR's leave-request payload carries `policy_id` but not the policy name.
 * Fetch the policy list once and build a lookup so we can attach `policy`
 * (display name) to every aggregated bucket.
 */
export async function fetchPolicyNameMap(client: SageHRClient): Promise<Map<string, string>> {
  try {
    const policies = await client.policies.list();
    const entries: Array<[string, string]> = [];
    for (const p of policies) {
      if (typeof p.name === "string") entries.push([String(p.id), p.name]);
    }
    return new Map(entries);
  } catch {
    return new Map();
  }
}

export function withPolicyName(
  bucket: PolicyBucket,
  policyNameById: Map<string, string>,
): PolicyBucket & { policy: string | null } {
  const id = bucket.policy_id == null ? null : String(bucket.policy_id);
  return {
    ...bucket,
    policy: id ? (policyNameById.get(id) ?? null) : null,
  };
}

export async function attachPolicyNames(
  client: SageHRClient,
  buckets: PolicyBucket[],
): Promise<Array<PolicyBucket & { policy: string | null }>> {
  const map = await fetchPolicyNameMap(client);
  return buckets.map((b) => withPolicyName(b, map));
}

export function defaultYearStart(today: Date = new Date()): string {
  return `${today.getUTCFullYear()}-01-01`;
}

export function todayISO(today: Date = new Date()): string {
  const y = today.getUTCFullYear();
  const m = String(today.getUTCMonth() + 1).padStart(2, "0");
  const d = String(today.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
