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
  trendSignalIds: z.array(z.coerce.number().int().positive()).max(5).default([]),
  refinementInstruction: z.string().trim().max(320).optional(),
  generationMode: z.enum(["auto", "native_ai", "with_text", "structured_layout"]).default("auto"),
});

const qualityStrategySchema = z.object({
  hookType: z.string(),
  coreAngle: z.string(),
  proofPoint: z.string(),
  ctaApproach: z.string(),
});

const qualityAlternativeSchema = z.object({
  caption: z.string(),
  headlineText: z.string(),
  hashtags: z.array(z.string()),
  cta: z.string().optional(),
});

const safetyIssueSchema = z.object({
  category: z.string(),
  severity: z.string(),
  message: z.string(),
});

export const generatePostResponseSchema = z.object({
  generationId: z.number().int().positive(),
  caption: z.string(),
  hashtags: z.array(z.string()),
  imageUrl: z.string().url(),
  generationMode: z.enum(["auto", "native_ai", "with_text", "structured_layout"]),
  imageGeneration: z.object({
    provider: z.enum(["replicate", "pollinations"]),
    model: z.string(),
    seed: z.number().int().nonnegative(),
    estimatedCostUsd: z.number().nonnegative(),
    latencyMs: z.number().int().nonnegative(),
  }),
  safetyJudge: z.object({
    passed: z.boolean(),
    score: z.number().int().min(0).max(100),
    rationale: z.string(),
    issues: z.array(
      z.object({
        category: z.enum(["ip", "policy", "brand", "platform"]),
        severity: z.enum(["low", "medium", "high"]),
        message: z.string(),
      })
    ),
  }),
  usedHeadline: z.string(),
  imageDirection: z.string(),
  quality: z.object({
    score: z.number().int().min(0).max(100),
    reasons: z.array(z.string()),
    strategy: qualityStrategySchema,
    alternatives: z.array(qualityAlternativeSchema),
  }),
  delivery: z.object({
    aspectRatio: z.string(),
    captionSoftLimit: z.number().int().positive(),
    hashtagRange: z.string(),
    suggestedBestTime: z.string(),
  }),
  trendReferences: z.array(
    z.object({
      id: z.number().int().nonnegative(),
      title: z.string(),
      source: z.string().optional(),
      url: z.string().url().optional(),
    })
  ),
  safety: z.object({
    passed: z.boolean(),
    score: z.number().int().min(0).max(100),
    issues: z.array(safetyIssueSchema),
  }),
});
