import { z } from "zod";

export const LeavePolicySchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    name: z.string(),
    accrual_type: z.string().nullable().optional(),
    color: z.string().nullable().optional(),
    is_paid: z.boolean().nullable().optional(),
    unit: z.string().nullable().optional(),
  })
  .passthrough();

export type LeavePolicy = z.infer<typeof LeavePolicySchema>;

export const LeaveBalanceSchema = z
  .object({
    employee_id: z.union([z.number(), z.string()]).optional(),
    policy_id: z.union([z.number(), z.string()]).optional(),
    policy: z.string().nullable().optional(),
    balance: z.number().nullable().optional(),
    used: z.number().nullable().optional(),
    available: z.number().nullable().optional(),
    unit: z.string().nullable().optional(),
  })
  .passthrough();

export type LeaveBalance = z.infer<typeof LeaveBalanceSchema>;
