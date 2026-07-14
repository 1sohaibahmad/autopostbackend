import { z } from "zod";

export const upsertBrandProfileSchema = z.object({
  brand_name: z.string().trim().min(1).max(160),
  industry: z.string().trim().min(1).max(120),
  target_audience: z.string().trim().max(4000).optional().nullable(),
  brand_voice: z.string().trim().max(120).optional().nullable(),
  logo_url: z.string().url().optional().nullable(),
  brand_colors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).max(8).default([]),
  website_url: z.string().url().optional().nullable(),
  products: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        description: z.string().trim().max(2000).default(""),
      })
    )
    .max(50)
    .default([]),
  topics_to_avoid: z.string().trim().max(2000).optional().nullable(),
  banned_words: z.array(z.string().trim().min(1).max(80)).max(100).default([]),
  preferred_platforms: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
});
