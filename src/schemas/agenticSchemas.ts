import { z } from "zod";
import { platformSchema, postTypeSchema } from "./common";

export const ingestTrendSignalsSchema = z.object({
  source: z.string().trim().min(2).max(80),
  signals: z.array(
    z.object({
      externalId: z.string().trim().min(1).max(120),
      title: z.string().trim().min(3).max(240),
      description: z.string().trim().min(8).max(5000),
      url: z.string().url().optional(),
      tags: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
      platformHints: z.array(platformSchema).max(6).default([]),
      language: z.string().trim().max(12).default("en"),
      region: z.string().trim().max(20).default("global"),
      velocityScore: z.number().min(0).max(100).default(50),
      publishedAt: z.string().datetime().optional(),
    })
  ).min(1).max(100),
});

export const listTrendSignalsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  source: z.string().trim().max(80).optional(),
});

export const recomputeMatchesSchema = z.object({
  brandProfileId: z.coerce.number().int().positive(),
  platform: platformSchema,
  limitSignals: z.coerce.number().int().min(1).max(200).default(100),
});

export const listMatchesQuerySchema = z.object({
  brandProfileId: z.coerce.number().int().positive(),
  platform: platformSchema,
  minScore: z.coerce.number().int().min(0).max(100).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const upsertAutopilotSettingsSchema = z.object({
  brandProfileId: z.coerce.number().int().positive(),
  enabled: z.boolean().default(true),
  platforms: z.array(platformSchema).min(1).max(6),
  minRelevanceScore: z.coerce.number().int().min(0).max(100).default(70),
  maxDraftsPerRun: z.coerce.number().int().min(1).max(10).default(2),
  postType: postTypeSchema.default("trend_based"),
});

export const runAutopilotSchema = z.object({
  brandProfileId: z.coerce.number().int().positive(),
  platform: platformSchema,
  maxDrafts: z.coerce.number().int().min(1).max(10).default(2),
  postType: postTypeSchema.default("trend_based"),
});
