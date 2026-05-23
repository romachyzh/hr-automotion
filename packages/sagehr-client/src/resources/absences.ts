import { z } from "zod";
import type { SageHRClient } from "../client.js";
import { AbsenceSchema, type Absence } from "../schemas/absence.js";
import { chunkDateRange } from "../pagination.js";

const PATH_LIST = "/leave-management/out-of-office";

export interface ListAbsencesParams {
  /** Required — ISO date YYYY-MM-DD. */
  from: string;
  /** Required — ISO date YYYY-MM-DD. */
  to: string;
  team_id?: number | string;
}

const AbsenceListSchema = z
  .object({
    data: z.array(AbsenceSchema),
  })
  .passthrough();

export class AbsencesResource {
  constructor(private readonly client: SageHRClient) {}

  /**
   * Out-of-office records within `from`..`to`. Auto-chunks ranges longer than
   * 60 days because SageHR's leave-management endpoints reject anything ≥65.
   */
  async list(params: ListAbsencesParams): Promise<Absence[]> {
    if (!params.from || !params.to) {
      throw new Error("AbsencesResource.list: `from` and `to` are required");
    }
    const windows = chunkDateRange(params.from, params.to, 60);
    const all: Absence[] = [];
    for (const w of windows) {
      const raw = await this.client.request<unknown>(PATH_LIST, {
        query: {
          from: w.from,
          to: w.to,
          team_id: params.team_id,
        },
      });
      all.push(...AbsenceListSchema.parse(raw).data);
    }
    return all;
  }
}
