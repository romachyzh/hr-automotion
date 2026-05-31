import { z } from "zod";

/**
 * Verified empirically against a live SageHR tenant (May 2026).
 *
 * Notable findings:
 *   • SageHR does NOT return a pre-computed `days_count` on this endpoint —
 *     callers must derive the duration from start_date / end_date and the
 *     is_part_of_day / first_part_of_day / second_part_of_day flags.
 *   • Two status fields ship side-by-side: `status` (human-readable,
 *     e.g. "Approved") and `status_code` (machine-readable, e.g. "approved").
 *     Prefer `status_code` in aggregations.
 *   • The free-text note field is `details`, not `employee_note`/`admin_note`.
 *   • `hours` (not `hours_count`) is set for partial-day requests when a
 *     specific time window is given.
 *   • `fields` is an array of tenant-defined custom fields, opaque to us.
 */
export const LeaveRequestSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    employee_id: z.union([z.number(), z.string()]),
    policy_id: z.union([z.number(), z.string()]).nullable().optional(),

    // Status — both shapes ship; prefer status_code for logic, status for display.
    status: z.string().nullable().optional(),
    status_code: z.string().nullable().optional(),

    // Date range / shape
    start_date: z.string().nullable().optional(),
    end_date: z.string().nullable().optional(),
    is_single_day: z.boolean().nullable().optional(),
    is_multi_date: z.boolean().nullable().optional(),
    is_part_of_day: z.boolean().nullable().optional(),
    first_part_of_day: z.boolean().nullable().optional(),
    second_part_of_day: z.boolean().nullable().optional(),

    // Time-of-day (set only for specific_time = true)
    specific_time: z.boolean().nullable().optional(),
    start_time: z.string().nullable().optional(),
    end_time: z.string().nullable().optional(),
    hours: z.number().nullable().optional(),

    // Notes / metadata
    details: z.string().nullable().optional(),
    request_date: z.string().nullable().optional(),
    approval_date: z.string().nullable().optional(),

    // Misc tenant-specific
    replacement: z.unknown().nullable().optional(),
    child_id: z.union([z.number(), z.string()]).nullable().optional(),
    shared_person_name: z.string().nullable().optional(),
    shared_person_nin: z.string().nullable().optional(),
    fields: z.array(z.unknown()).optional(),
  })
  .passthrough();

export type LeaveRequest = z.infer<typeof LeaveRequestSchema>;

export interface LeaveDaysOptions {
  /**
   * Count Saturday and Sunday as leave days. Default `false` — i.e. only
   * Mon–Fri are counted, matching the working-day total SageHR shows for a
   * standard 5-day week. Set `true` only for policies configured to "count
   * weekends as workdays".
   */
  countWeekends?: boolean;
  /**
   * Public-holiday dates (ISO `YYYY-MM-DD`) that should NOT be counted when
   * they fall on an otherwise-working day. SageHR's own count subtracts these
   * unless the policy is set to "count public holidays as workdays". This
   * endpoint doesn't return them, so the caller must supply the calendar.
   */
  holidays?: Iterable<string>;
}

/**
 * Derive the number of leave days an employee actually took from a leave
 * request.
 *
 * - Multi-day full leave: count of working days in [start_date, end_date],
 *   excluding weekends (and any supplied `holidays`).
 * - Single-day full: 1 if it's a working day, else 0.
 * - Half-day (is_part_of_day):
 *     • both first+second halves → 1
 *     • one half → 0.5
 *     • neither flag set but is_part_of_day true → 0.5 (safe default)
 *
 * IMPORTANT: this counts *business* days for a standard Mon–Fri week. The
 * fully-authoritative number is computed server-side by SageHR from the
 * policy type (calendar- vs working-pattern-based), the employee's individual
 * working pattern, and the tenant's holiday calendar — none of which are on
 * the `/leave-management/requests` payload. This approximation matches SageHR
 * for the common case (5-day week, weekends not counted); pass `holidays` to
 * also subtract public holidays, or `countWeekends: true` for policies that
 * count weekends. For an exact per-policy "used" total, prefer the
 * employee leave-balances endpoint, which returns SageHR's own figure.
 */
export function computeLeaveDays(req: LeaveRequest, opts: LeaveDaysOptions = {}): number {
  if (req.is_part_of_day) {
    const halves =
      (req.first_part_of_day ? 0.5 : 0) + (req.second_part_of_day ? 0.5 : 0);
    return halves > 0 ? halves : 0.5;
  }
  if (!req.start_date) return 0;
  const startMs = Date.parse(`${req.start_date}T00:00:00Z`);
  const endMs = req.end_date
    ? Date.parse(`${req.end_date}T00:00:00Z`)
    : startMs;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return 0;
  }

  const countWeekends = opts.countWeekends ?? false;
  const holidays = opts.holidays ? new Set(opts.holidays) : null;

  let days = 0;
  for (let ms = startMs; ms <= endMs; ms += 86_400_000) {
    if (!countWeekends) {
      const dow = new Date(ms).getUTCDay(); // 0 = Sunday, 6 = Saturday
      if (dow === 0 || dow === 6) continue;
    }
    if (holidays && holidays.has(isoDateUTC(ms))) continue;
    days += 1;
  }
  return days;
}

function isoDateUTC(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
