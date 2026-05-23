import { z } from "zod";

/**
 * Verified empirically against a live SageHR tenant (May 2026).
 * Real fields on `/teams`: id, name, manager_ids, employee_ids.
 * `manager_ids` and `employee_ids` are arrays of numeric employee ids.
 */
export const TeamSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    name: z.string().nullable().optional(),
    manager_ids: z.array(z.union([z.number(), z.string()])).optional(),
    employee_ids: z.array(z.union([z.number(), z.string()])).optional(),
  })
  .passthrough();

export type Team = z.infer<typeof TeamSchema>;

/**
 * Verified empirically against a live SageHR tenant (May 2026).
 *
 * /positions returns { id, title, description, code }. The label field
 * is `title` — NOT `name` like /teams uses. Models reading positions
 * should expect `title` to carry the human-readable position label.
 * `description` and `code` are often empty strings.
 */
export const PositionSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    title: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    code: z.string().nullable().optional(),
  })
  .passthrough();

export type Position = z.infer<typeof PositionSchema>;
