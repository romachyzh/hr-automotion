import { z } from "zod";
import type { SageHRClient } from "../client.js";
import { PositionSchema, type Position } from "../schemas/team.js";

const PATH_LIST = "/positions";

const PositionListSchema = z
  .object({
    data: z.array(PositionSchema),
  })
  .passthrough();

export class PositionsResource {
  constructor(private readonly client: SageHRClient) {}

  async list(): Promise<Position[]> {
    const raw = await this.client.request<unknown>(PATH_LIST);
    return PositionListSchema.parse(raw).data;
  }
}
