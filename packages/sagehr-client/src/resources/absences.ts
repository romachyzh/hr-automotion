import { z } from "zod";
import type { SageHRClient } from "../client.js";
import { AbsenceSchema, type Absence } from "../schemas/absence.js";

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

  async list(params: ListAbsencesParams): Promise<Absence[]> {
    if (!params.from || !params.to) {
      throw new Error("AbsencesResource.list: `from` and `to` are required");
    }
    const raw = await this.client.request<unknown>(PATH_LIST, {
      query: {
        from: params.from,
        to: params.to,
        team_id: params.team_id,
      },
    });
    return AbsenceListSchema.parse(raw).data;
  }
}
