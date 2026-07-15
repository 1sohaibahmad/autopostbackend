import { HttpError } from "../lib/httpError";
import { supabase } from "../lib/supabase";
import { generateImage } from "./imageGenService";
import { formatForPlatform } from "./platformFormatterService";
import { getBrandProfileForUserById } from "./brandProfileService";
import { reviewSafety } from "./safetyReviewService";
import { renderPostImage } from "./templateRenderService";
import { generateCaption } from "./textGenService";
import { trackUsageEvent } from "./usageMeteringService";

const DAILY_POST_LIMIT = 3;

function getUtcDayWindow(now = new Date()): { start: string; end: string } {
  const startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
  return {
    start: startDate.toISOString(),
    end: endDate.toISOString(),
  };
}

async function enforceDailyPostLimit(userId: string): Promise<void> {
  const window = getUtcDayWindow();

  const { count, error } = await supabase
    .from("generations")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", window.start)
    .lt("created_at", window.end);

  if (error) {
    throw new HttpError(500, "Failed to verify daily post usage", "USAGE_LIMIT_CHECK_FAILED", {
      reason: error.message,
    });
  }

  const generatedToday = count ?? 0;
  if (generatedToday >= DAILY_POST_LIMIT) {
    throw new HttpError(429, "Daily generation limit reached (3 posts/day)", "DAILY_POST_LIMIT_REACHED", {
      limit: DAILY_POST_LIMIT,
      generatedToday,
      windowStartUtc: window.start,
      windowEndUtc: window.end,
    });
  }
}

function featureTags(postType: string, industry: string, platform: string): string[] {
  const features: string[] = [];
  if (industry) features.push(industry);
  if (postType === "product_promotion") features.push("Featured Product");
  if (postType === "infographic") features.push("Data Snapshot");
  if (postType === "how_to") features.push("Step by Step");
  if (postType === "holiday_occasion") features.push("Seasonal Moment");
  if (postType === "engagement") features.push("Join Us");
  if (postType === "review_testimonial") features.push("Testimonial");
  if (postType === "comparison") features.push("Compare Options");
  if (postType === "trend_based") features.push("Trending Now");
  features.push(platform.charAt(0).toUpperCase() + platform.slice(1));
  return features.slice(0, 3);
}

function platformDeliveryHints(platform: string): {
  aspectRatio: string;
  captionSoftLimit: number;
  hashtagRange: string;
  suggestedBestTime: string;
} {
  if (platform === "instagram") {
    return { aspectRatio: "4:5", captionSoftLimit: 2200, hashtagRange: "8-12", suggestedBestTime: "11:00 AM local" };
  }
  if (platform === "linkedin") {
    return { aspectRatio: "1:1", captionSoftLimit: 900, hashtagRange: "3-5", suggestedBestTime: "8:30 AM local" };
  }
  if (platform === "x") {
    return { aspectRatio: "16:9", captionSoftLimit: 260, hashtagRange: "2-4", suggestedBestTime: "12:00 PM local" };
  }
  if (platform === "tiktok") {
    return { aspectRatio: "9:16", captionSoftLimit: 400, hashtagRange: "4-8", suggestedBestTime: "7:30 PM local" };
  }
  if (platform === "pinterest") {
    return { aspectRatio: "2:3", captionSoftLimit: 500, hashtagRange: "4-8", suggestedBestTime: "8:00 PM local" };
  }
  return { aspectRatio: "1.91:1", captionSoftLimit: 1200, hashtagRange: "5-10", suggestedBestTime: "1:00 PM local" };
}

export async function generatePostForUser(params: {
  userId: string;
  brandProfileId: number;
  platform: "instagram" | "facebook" | "linkedin" | "x" | "tiktok" | "pinterest";
  postType:
    | "product_promotion"
    | "trend_based"
    | "infographic"
    | "how_to"
    | "review_testimonial"
    | "comparison"
    | "engagement"
    | "holiday_occasion";
  topic: string;
  tone: string;
  objective?: "awareness" | "engagement" | "leads" | "sales";
  audienceSegment?: string;
  proofPoints?: string[];
  customHeadline?: string;
  trendBriefId?: number;
  trendSignalIds?: number[];
  refinementInstruction?: string;
}) {
  if (!params.refinementInstruction?.trim()) {
    await enforceDailyPostLimit(params.userId);
  }

  const brandProfile = await getBrandProfileForUserById(params.userId, params.brandProfileId);

  let trendContext: { summary?: string; adaptationAngle?: string; objective?: string } | undefined;
  let trendReferences: Array<{ id: number; title: string; source?: string; url?: string }> = [];
  if (params.trendBriefId) {
    const { data: trendBrief } = await supabase
      .from("trend_briefs")
      .select("summary,adaptation_angle,objective")
      .eq("id", params.trendBriefId)
      .eq("user_id", params.userId)
      .maybeSingle();
    if (trendBrief) {
      trendContext = {
        summary: trendBrief.summary,
        adaptationAngle: trendBrief.adaptation_angle,
        objective: trendBrief.objective,
      };
    }
  }

  if (!trendContext && params.trendSignalIds?.length) {
    const { data: selectedSignals } = await supabase
      .from("trend_signals")
      .select("id,title,description,tags,velocity_score,source,url")
      .eq("user_id", params.userId)
      .in("id", params.trendSignalIds);

    if (selectedSignals?.length) {
      const ranked = [...selectedSignals].sort((a, b) => (Number(b.velocity_score) || 0) - (Number(a.velocity_score) || 0));
      const summaryLines = ranked.slice(0, 3).map((s) => `- ${s.title}: ${String(s.description).slice(0, 180)}`);
      const topTags = Array.from(new Set(ranked.flatMap((s: any) => s.tags ?? []))).slice(0, 8);
      trendReferences = ranked.slice(0, 5).map((s: any) => ({ id: Number(s.id), title: String(s.title), source: s.source ?? undefined, url: s.url ?? undefined }));

      trendContext = {
        summary: `Live trend bundle:\n${summaryLines.join("\n")}`,
        adaptationAngle: topTags.length ? `Lean into these themes: ${topTags.join(", ")}` : "Prioritize fast-moving conversation hooks.",
        objective: params.objective ?? "engagement",
      };
    }
  }

  const generated = await generateCaption(
    {
      brand_name: brandProfile.brand_name,
      industry: brandProfile.industry,
      target_audience: brandProfile.target_audience ?? "",
      brand_voice: brandProfile.brand_voice ?? "",
      products: brandProfile.products,
      banned_words: brandProfile.banned_words,
      topics_to_avoid: brandProfile.topics_to_avoid ? [brandProfile.topics_to_avoid] : [],
    },
    params.platform,
    params.postType,
    params.topic,
    params.tone,
    trendContext,
    {
      objective: params.objective,
      audienceSegment: params.audienceSegment,
      proofPoints: params.proofPoints,
      refinementInstruction: params.refinementInstruction,
    }
  );

  const backgroundImageUrl = await generateImage(generated.imageDirection);
  const usedHeadline = params.customHeadline?.trim() || generated.headlineText;

  const formatted = formatForPlatform(params.platform, generated.caption, generated.hashtags);
  const safety = reviewSafety({
    caption: formatted.caption,
    hashtags: formatted.hashtags,
    platform: params.platform,
    bannedWords: brandProfile.banned_words,
    topicsToAvoid: brandProfile.topics_to_avoid ? [brandProfile.topics_to_avoid] : [],
  });

  if (!safety.passed) {
    throw new HttpError(422, "Generated content failed safety checks", "SAFETY_REVIEW_FAILED", {
      issues: safety.issues,
    });
  }

  const ctaText = brandProfile.website_url
    ? brandProfile.website_url.replace(/^https?:\/\//, "").replace(/\/$/, "")
    : brandProfile.brand_name;

  const imageBuffer = await renderPostImage({
    headline: usedHeadline,
    subtext: formatted.caption.slice(0, 140),
    brandColors: brandProfile.brand_colors ?? [],
    brandLogo: brandProfile.logo_url,
    brandName: brandProfile.brand_name,
    backgroundImageUrl,
    features: featureTags(params.postType, brandProfile.industry, params.platform),
    ctaText,
  });

  const filename = `post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  const { error: uploadError } = await supabase.storage.from("generated-posts").upload(filename, imageBuffer, {
    contentType: "image/png",
    upsert: false,
  });

  if (uploadError) {
    throw new HttpError(500, "Failed to upload image to storage", "STORAGE_UPLOAD_FAILED", {
      reason: uploadError.message,
    });
  }

  const { data: urlData } = supabase.storage.from("generated-posts").getPublicUrl(filename);

  const { data: generation, error } = await supabase
    .from("generations")
    .insert({
      user_id: params.userId,
      brand_profile_id: params.brandProfileId,
      trend_brief_id: params.trendBriefId ?? null,
      platform: params.platform,
      post_type: params.postType,
      topic: params.topic,
      tone: params.tone,
      caption: formatted.caption,
      hashtags: formatted.hashtags,
      cta: generated.cta ?? ctaText,
      image_url: urlData.publicUrl,
      used_headline: usedHeadline,
      image_direction: generated.imageDirection,
      quality_score: generated.qualityScore,
      quality_reasons: generated.qualityReasons,
      strategy: generated.strategy,
      alternatives: generated.alternatives,
      safety_issues: safety.issues,
      safety_score: safety.score,
    })
    .select("id")
    .single();

  if (error) {
    throw new HttpError(500, error.message, "DB_ERROR");
  }

  await trackUsageEvent({
    userId: params.userId,
    eventType: "post_generated",
    metadata: { generationId: generation.id, platform: params.platform },
  });

  return {
    generationId: generation.id,
    caption: formatted.caption,
    hashtags: formatted.hashtags,
    imageUrl: urlData.publicUrl,
    usedHeadline,
    imageDirection: generated.imageDirection,
    quality: {
      score: generated.qualityScore,
      reasons: generated.qualityReasons,
      strategy: generated.strategy,
      alternatives: generated.alternatives,
    },
    delivery: platformDeliveryHints(params.platform),
    trendReferences,
    safety,
  };
}
