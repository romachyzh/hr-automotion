import { z } from "zod";

/**
 * Verified empirically against a live SageHR tenant (May 2026).
 * Real fields on `/leave-management/policies`:
 *   id, name, color, unit, do_not_accrue, default_allowance,
 *   max_carryover, accrue_type
 *
 * Note: it's `accrue_type` (not `accrual_type`), and there's no
 * `is_paid` field — allowance/accrual policy is described by
 * default_allowance + do_not_accrue + accrue_type.
 */
export const LeavePolicySchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    name: z.string().nullable().optional(),
    color: z.string().nullable().optional(),
    unit: z.string().nullable().optional(), // "days" | "hours" typically
    do_not_accrue: z.boolean().nullable().optional(),
    default_allowance: z.union([z.string(), z.number()]).nullable().optional(),
    max_carryover: z.union([z.string(), z.number()]).nullable().optional(),
    accrue_type: z.string().nullable().optional(), // e.g. "yearly", "monthly"
  })
  .passthrough();

export type LeavePolicy = z.infer<typeof LeavePolicySchema>;

/**
 * Balances envelope hasn't been verified live yet — the shape below is the
 * best-guess from SageHR convention. Permissive so unknown fields pass through.
 */
export const LeaveBalanceSchema = z
  .object({
    employee_id: z.union([z.number(), z.string()]).optional(),
    policy_id: z.union([z.number(), z.string()]).optional(),
    policy: z.string().nullable().optional(),
    balance: z.union([z.string(), z.number()]).nullable().optional(),
    used: z.union([z.string(), z.number()]).nullable().optional(),
    available: z.union([z.string(), z.number()]).nullable().optional(),
    unit: z.string().nullable().optional(),
  })
  .passthrough();

export type LeaveBalance = z.infer<typeof LeaveBalanceSchema>;
