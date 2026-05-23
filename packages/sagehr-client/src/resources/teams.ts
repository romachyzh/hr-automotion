import { z } from "zod";
import type { SageHRClient } from "../client.js";
import { TeamSchema, type Team } from "../schemas/team.js";

const PATH_LIST = "/teams";

const TeamListSchema = z
  .object({
    data: z.array(TeamSchema),
  })
  .passthrough();

export class TeamsResource {
  constructor(private readonly client: SageHRClient) {}

  async list(): Promise<Team[]> {
    const raw = await this.client.request<unknown>(PATH_LIST);
    return TeamListSchema.parse(raw).data;
  }
}
