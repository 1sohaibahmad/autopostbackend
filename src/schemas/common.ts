import { z } from "zod";

export const platformSchema = z.enum([
  "instagram",
  "facebook",
  "linkedin",
  "x",
  "tiktok",
  "pinterest",
]);

export const postTypeSchema = z.enum([
  "product_promotion",
  "trend_based",
  "how_to",
  "announcement",
  "review",
  "engagement",
]);
