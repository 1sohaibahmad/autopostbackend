import { z } from "zod";
import { platformSchema } from "./common";

export const createTrendBriefSchema = z.object({
  brandProfileId: z.coerce.number().int().positive(),
  platform: platformSchema,
  trendTitle: z.string().trim().min(3).max(180),
  trendDescription: z.string().trim().min(8).max(3000),
  objective: z.enum(["awareness", "engagement", "leads", "sales"]).default("engagement"),
});
