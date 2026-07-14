import { z } from "zod";
import { platformSchema, postTypeSchema } from "./common";

export const generatePostSchema = z.object({
  brandProfileId: z.coerce.number().int().positive(),
  platform: platformSchema,
  postType: postTypeSchema,
  topic: z.string().trim().max(500).default(""),
  tone: z.string().trim().max(120).default("match_brand_voice"),
  objective: z.enum(["awareness", "engagement", "leads", "sales"]).default("engagement"),
  audienceSegment: z.string().trim().max(200).optional(),
  proofPoints: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
  customHeadline: z.string().trim().max(120).optional(),
  trendBriefId: z.coerce.number().int().positive().optional(),
});
