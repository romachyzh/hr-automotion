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
 * Verified empirically (May 2026): `/positions` rejected my earlier
 * `name: string` schema across 37 records — SageHR's positions payload
 * uses a different field name (likely `title`). Until the real field
 * is confirmed, every property is optional + passthrough so the raw
 * payload is preserved and visible to the model.
 */
export const PositionSchema = z
  .object({
    id: z.union([z.number(), z.string()]).optional(),
    name: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    employees_count: z.number().int().nonnegative().nullable().optional(),
  })
  .passthrough();

export type Position = z.infer<typeof PositionSchema>;
