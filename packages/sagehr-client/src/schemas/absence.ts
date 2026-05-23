import { z } from "zod";

export const AbsenceSchema = z
  .object({
    id: z.union([z.number(), z.string()]).optional(),
    employee_id: z.union([z.number(), z.string()]).optional(),
    date: z.string().nullable().optional(),
    start_date: z.string().nullable().optional(),
    end_date: z.string().nullable().optional(),
    policy: z.string().nullable().optional(),
    policy_id: z.union([z.number(), z.string()]).nullable().optional(),
    status: z.string().nullable().optional(),
    is_part_of_day: z.boolean().nullable().optional(),
    hours: z.number().nullable().optional(),
  })
  .passthrough();

export type Absence = z.infer<typeof AbsenceSchema>;
