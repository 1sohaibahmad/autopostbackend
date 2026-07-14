import { z } from "zod";
import { platformSchema } from "./common";

export const createDraftSchema = z.object({
  brandProfileId: z.coerce.number().int().positive(),
  platform: platformSchema,
  caption: z.string().trim().min(1).max(5000),
  hashtags: z.array(z.string().trim().min(1).max(80)).max(60).default([]),
  cta: z.string().trim().max(240).default(""),
  imageUrl: z.string().url().optional().nullable(),
  status: z.enum(["draft", "approved", "scheduled"]).default("draft"),
  scheduledAt: z.string().datetime().optional().nullable(),
});

export const updateDraftSchema = createDraftSchema.partial().extend({
  id: z.coerce.number().int().positive(),
});

export const listDraftQuerySchema = z.object({
  status: z.enum(["draft", "approved", "scheduled"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
