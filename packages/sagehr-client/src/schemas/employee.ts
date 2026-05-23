import { z } from "zod";

/**
 * Permissive schema — SageHR has many optional fields and tenants enable
 * different ones. We capture the common shape and pass through unknowns.
 */
export const EmployeeSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    email: z.string().email().nullable().optional(),
    first_name: z.string().nullable().optional(),
    last_name: z.string().nullable().optional(),
    full_name: z.string().nullable().optional(),
    employment_status: z.string().nullable().optional(),
    team_id: z.union([z.number(), z.string()]).nullable().optional(),
    team: z.string().nullable().optional(),
    position_id: z.union([z.number(), z.string()]).nullable().optional(),
    position: z.string().nullable().optional(),
    reports_to_employee_id: z.union([z.number(), z.string()]).nullable().optional(),
    start_date: z.string().nullable().optional(),
    end_date: z.string().nullable().optional(),
    date_of_birth: z.string().nullable().optional(),
    phone_number: z.string().nullable().optional(),
    picture_url: z.string().url().nullable().optional(),
  })
  .passthrough();

export type Employee = z.infer<typeof EmployeeSchema>;
