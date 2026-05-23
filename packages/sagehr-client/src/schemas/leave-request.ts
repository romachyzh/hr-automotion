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

/**
 * Derive a calendar-day count from a leave request.
 *
 * - Multi-day full leave: end_date − start_date + 1 (inclusive)
 * - Single-day full: 1
 * - Half-day (is_part_of_day):
 *     • both first+second halves → 1
 *     • one half → 0.5
 *     • neither flag set but is_part_of_day true → 0.5 (safe default)
 *
 * NOTE: This is *calendar* days, not business days. SageHR's own UI usually
 * displays business days, computed against each employee's workweek and
 * holiday calendar — info that's not in this endpoint's response. For most
 * reporting needs the calendar count is close enough; if you need exact
 * business-day accounting, walk to the policy's `unit` and a holiday list.
 */
export function computeLeaveDays(req: LeaveRequest): number {
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
  return Math.round((endMs - startMs) / 86_400_000) + 1;
}
