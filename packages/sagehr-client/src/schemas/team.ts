import { z } from "zod";

export const TeamSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    name: z.string(),
    parent_team_id: z.union([z.number(), z.string()]).nullable().optional(),
    employees_count: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export type Team = z.infer<typeof TeamSchema>;

export const PositionSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    name: z.string(),
    employees_count: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export type Position = z.infer<typeof PositionSchema>;
