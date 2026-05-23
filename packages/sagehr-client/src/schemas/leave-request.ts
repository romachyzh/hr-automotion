import { z } from "zod";

export const LeaveRequestSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    employee_id: z.union([z.number(), z.string()]),
    policy_id: z.union([z.number(), z.string()]).nullable().optional(),
    policy: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    start_date: z.string().nullable().optional(),
    end_date: z.string().nullable().optional(),
    days_count: z.number().nullable().optional(),
    hours_count: z.number().nullable().optional(),
    is_part_of_day: z.boolean().nullable().optional(),
    is_multi_date: z.boolean().nullable().optional(),
    employee_note: z.string().nullable().optional(),
    admin_note: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
  })
  .passthrough();

export type LeaveRequest = z.infer<typeof LeaveRequestSchema>;
