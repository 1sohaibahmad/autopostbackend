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
  "infographic",
  "how_to",
  "review_testimonial",
  "comparison",
  "engagement",
  "holiday_occasion",
]);
