import { HttpError } from "../lib/httpError";
import { supabase } from "../lib/supabase";
import { addTextOverlay, generateImage } from "./imageGenService";
import { formatForPlatform } from "./platformFormatterService";
import { getBrandProfileForUserById } from "./brandProfileService";
import { reviewSafety } from "./safetyReviewService";
import { renderPostImage } from "./templateRenderService";
import { generateCaption } from "./textGenService";
import { fetchTrendExamples } from "./trendSignalService";
import { trackUsageEvent } from "./usageMeteringService";
import { runFinalSafetyJudge } from "./finalSafetyJudgeService";

const DAILY_POST_LIMIT = 5;

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
    throw new HttpError(429, `Daily generation limit reached (${DAILY_POST_LIMIT} posts/day)`, "DAILY_POST_LIMIT_REACHED", {
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

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

function estimateGenerationCostUsd(params: { provider: "replicate" | "pollinations"; promptLength: number; judgeCalls: number }): number {
  const textCost = 0.0000018 * Math.max(params.promptLength, 1);
  const imageCost = params.provider === "replicate" ? 0.025 : 0;
  const judgeCost = params.judgeCalls * 0.0012;
  return Number((textCost + imageCost + judgeCost).toFixed(6));
}

function combineRefinementInstruction(userInstruction: string | undefined, forcedInstruction: string | undefined): string | undefined {
  const user = userInstruction?.trim();
  const forced = forcedInstruction?.trim();
  if (user && forced) return `${user}\n\n${forced}`;
  return user || forced || undefined;
}

function imageDimensionsForPlatform(platform: "instagram" | "facebook" | "linkedin" | "x" | "tiktok" | "pinterest"): {
  width: number;
  height: number;
} {
  if (platform === "instagram") return { width: 1080, height: 1350 };
  if (platform === "linkedin") return { width: 1200, height: 1200 };
  if (platform === "facebook") return { width: 1200, height: 630 };
  if (platform === "x") return { width: 1600, height: 900 };
  if (platform === "tiktok") return { width: 1080, height: 1920 };
  if (platform === "pinterest") return { width: 1000, height: 1500 };
  return { width: 1080, height: 1350 };
}

function marketingImageDirection(params: {
  baseDirection: string;
  platform: "instagram" | "facebook" | "linkedin" | "x" | "tiktok" | "pinterest";
  generationMode: "auto" | "native_ai" | "with_text" | "structured_layout";
  brandName: string;
  industry: string;
}): string {
  const compositionHint = params.generationMode === "with_text" || params.generationMode === "structured_layout"
    ? "Reserve clean negative space in upper third for headline overlay"
    : "Compose for native social feed impact";

  return [
    params.baseDirection,
    `Commercial marketing creative for ${params.brandName} in ${params.industry}`,
    "Photorealistic style, 1-3 natural human subjects, authentic expressions, realistic hands and skin texture",
    "High production ad lighting, clean background separation, premium camera depth",
    `${compositionHint} for ${params.platform}`,
    "Brand-safe and IP-safe: no logos, no celebrity likeness, no trademarked characters, no copyrighted art",
  ].join(". ");
}

function extractUnsafeReferences(issues: Array<{ message: string }>): string[] {
  const tokens = new Set<string>();
  for (const issue of issues) {
    const quoted = issue.message.match(/['\"]([^'\"]{2,60})['\"]/g) ?? [];
    for (const raw of quoted) {
      tokens.add(raw.replace(/^['\"]|['\"]$/g, "").trim());
    }

    const toRef = issue.message.match(/reference to\s+([a-z0-9_-]{2,40})/i);
    if (toRef?.[1]) {
      tokens.add(toRef[1].trim());
    }

    const brandLike = issue.message.match(/\b([A-Z][A-Za-z0-9&-]{2,30})\b/g) ?? [];
    for (const token of brandLike.slice(0, 4)) {
      if (!["Reference", "The", "Additionally", "Topic", "Platform", "Brand"].includes(token)) {
        tokens.add(token.trim());
      }
    }
  }
  return Array.from(tokens).slice(0, 6);
}

function sanitizeTextByTerms(input: string, terms: string[]): string {
  let output = input;
  for (const term of terms) {
    const cleaned = term.trim();
    if (!cleaned) continue;
    const escaped = cleaned.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    output = output.replace(new RegExp(`\\b${escaped}\\b`, "gi"), "");
  }
  return output.replace(/\s{2,}/g, " ").replace(/\s+([.,!?])/g, "$1").trim();
}

function sanitizeHashtagsByTerms(tags: string[], terms: string[]): string[] {
  const loweredTerms = new Set(terms.map((term) => term.toLowerCase()));
  return tags.filter((tag) => {
    const normalized = tag.replace(/^#/, "").toLowerCase();
    return !loweredTerms.has(normalized);
  });
}

function resolveGenerationMode(
  requestedMode: "auto" | "native_ai" | "with_text" | "structured_layout",
  platform: "instagram" | "facebook" | "linkedin" | "x" | "tiktok" | "pinterest"
): "native_ai" | "with_text" | "structured_layout" {
  if (requestedMode !== "auto") return requestedMode;
  if (platform === "tiktok") return "native_ai";
  return "with_text";
}

interface PersistGenerationRowInput {
  userId: string;
  brandProfileId: number;
  trendBriefId?: number;
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
  generationMode: "auto" | "native_ai" | "with_text" | "structured_layout";
  ctaText: string;
  parentGenerationId?: number;
  totalLatencyMs: number;
  estimatedCostUsd: number;
  attempt: {
    retryAttempt: number;
    generationSeed: number;
    generated: {
      caption: string;
      hashtags: string[];
      cta?: string;
      imageDirection: string;
      qualityScore: number;
      qualityReasons: string[];
      strategy: {
        hookType: string;
        coreAngle: string;
        proofPoint: string;
        ctaApproach: string;
      };
      alternatives: Array<{ caption: string; headlineText: string; hashtags: string[]; cta?: string }>;
      promptUsed: string;
    };
    usedHeadline: string;
    formatted: {
      caption: string;
      hashtags: string[];
    };
    finalImageUrl: string;
    safety: {
      passed: boolean;
      score: number;
      issues: Array<{ category: string; severity: string; message: string }>;
    };
    baseImage: {
      provider: "replicate" | "pollinations";
      model: string;
    };
    finalJudge: {
      passed: boolean;
      score: number;
      issues: Array<{ category: string; severity: string; message: string }>;
      rationale: string;
      rawModel?: string;
    };
  };
}

async function persistGenerationRow(input: PersistGenerationRowInput): Promise<number> {
  const { data: generation, error } = await supabase
    .from("generations")
    .insert({
      user_id: input.userId,
      brand_profile_id: input.brandProfileId,
      trend_brief_id: input.trendBriefId ?? null,
      platform: input.platform,
      post_type: input.postType,
      topic: input.topic,
      tone: input.tone,
      caption: input.attempt.formatted.caption,
      hashtags: input.attempt.formatted.hashtags,
      cta: input.attempt.generated.cta ?? input.ctaText,
      image_url: input.attempt.finalImageUrl,
      used_headline: input.attempt.usedHeadline,
      image_direction: input.attempt.generated.imageDirection,
      quality_score: input.attempt.generated.qualityScore,
      quality_reasons: input.attempt.generated.qualityReasons,
      strategy: input.attempt.generated.strategy,
      alternatives: input.attempt.generated.alternatives,
      safety_issues: input.attempt.safety.issues,
      safety_score: input.attempt.safety.score,
      generation_mode: input.generationMode,
      image_provider: input.attempt.baseImage.provider,
      image_model: input.attempt.baseImage.model,
      prompt_text: input.attempt.generated.promptUsed,
      prompt_seed: input.attempt.generationSeed,
      estimated_cost_usd: input.estimatedCostUsd,
      latency_ms: input.totalLatencyMs,
      retry_attempt: input.attempt.retryAttempt,
      parent_generation_id: input.parentGenerationId ?? null,
      safety_judge_result: {
        passed: input.attempt.finalJudge.passed,
        score: input.attempt.finalJudge.score,
        issues: input.attempt.finalJudge.issues,
        rationale: input.attempt.finalJudge.rationale,
        judgeModel: input.attempt.finalJudge.rawModel,
      },
    })
    .select("id")
    .single();

  if (error) {
    throw new HttpError(500, error.message, "DB_ERROR");
  }

  return Number(generation.id);
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
  generationMode?: "auto" | "native_ai" | "with_text" | "structured_layout";
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

      let enrichedSummary = `Live trend bundle:\n${summaryLines.join("\n")}`;

      try {
        const examples = await fetchTrendExamples({
          trendTitle: String(ranked[0]?.title ?? params.topic),
          platform: params.platform,
          limit: 2,
        });
        if (examples.length) {
          const exampleLines = examples.map((item) => `- ${item.title} (${item.source})`).join("\n");
          enrichedSummary = `${enrichedSummary}\n\nRecent real examples:\n${exampleLines}`;
        }
      } catch {
        // best-effort enrichment only
      }

      trendContext = {
        summary: enrichedSummary,
        adaptationAngle: topTags.length ? `Lean into these themes: ${topTags.join(", ")}` : "Prioritize fast-moving conversation hooks.",
        objective: params.objective ?? "engagement",
      };
    }
  }

  const generationMode = resolveGenerationMode(params.generationMode ?? "auto", params.platform);
  const ctaText = brandProfile.website_url
    ? brandProfile.website_url.replace(/^https?:\/\//, "").replace(/\/$/, "")
    : brandProfile.brand_name;

  async function createAttempt(retryAttempt: number, forcedRefinement?: string) {
    const attemptStartedAt = Date.now();
    const generationSeed = randomSeed();
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
        refinementInstruction: combineRefinementInstruction(params.refinementInstruction, forcedRefinement),
      }
    );

    const imageDirection = marketingImageDirection({
      baseDirection: generated.imageDirection,
      platform: params.platform,
      generationMode,
      brandName: brandProfile.brand_name,
      industry: brandProfile.industry,
    });
    generated.imageDirection = imageDirection;

    const baseImage = await generateImage(imageDirection, imageDimensionsForPlatform(params.platform));
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

    let finalImageUrl = baseImage.url;
    if (generationMode === "with_text" || generationMode === "structured_layout") {
      const imageBuffer =
        generationMode === "with_text"
          ? await addTextOverlay(baseImage.url, usedHeadline, {
              subtitle: formatted.caption.slice(0, 120),
              cta: generated.cta ?? ctaText,
              brandName: brandProfile.brand_name,
            })
          : await renderPostImage({
              headline: usedHeadline,
              subtext: formatted.caption.slice(0, 140),
              brandColors: brandProfile.brand_colors ?? [],
              brandLogo: brandProfile.logo_url,
              brandName: brandProfile.brand_name,
              backgroundImageUrl: baseImage.url,
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
      finalImageUrl = urlData.publicUrl;
    }

    const finalJudge = await runFinalSafetyJudge({
      platform: params.platform,
      caption: formatted.caption,
      hashtags: formatted.hashtags,
      imageDirection,
      trendSummary: trendContext?.summary,
      bannedWords: brandProfile.banned_words,
      topicsToAvoid: brandProfile.topics_to_avoid ? [brandProfile.topics_to_avoid] : [],
    });

    return {
      retryAttempt,
      generationSeed,
      generated,
      baseImage,
      usedHeadline,
      formatted,
      finalImageUrl,
      safety,
      finalJudge,
      attemptLatencyMs: Date.now() - attemptStartedAt,
    };
  }

  const startMs = Date.now();
  const firstAttempt = await createAttempt(0);
  let activeAttempt = firstAttempt;
  let parentGenerationId: number | undefined;

  if (!firstAttempt.finalJudge.passed) {
    const disallowedRefs = extractUnsafeReferences(firstAttempt.finalJudge.issues);
    const refBlock = disallowedRefs.length ? ` Do not mention or imply these references: ${disallowedRefs.join(", ")}.` : "";
    const firstAttemptCostUsd = estimateGenerationCostUsd({
      provider: firstAttempt.baseImage.provider,
      promptLength: firstAttempt.generated.promptUsed.length,
      judgeCalls: 1,
    });
    parentGenerationId = await persistGenerationRow({
      userId: params.userId,
      brandProfileId: params.brandProfileId,
      trendBriefId: params.trendBriefId,
      platform: params.platform,
      postType: params.postType,
      topic: params.topic,
      tone: params.tone,
      generationMode,
      ctaText,
      totalLatencyMs: firstAttempt.attemptLatencyMs,
      estimatedCostUsd: firstAttemptCostUsd,
      attempt: firstAttempt,
    });

    activeAttempt = await createAttempt(
      1,
      `Regenerate with stricter safety and originality. Avoid copyrighted characters, logos, slogans, lyrics, trademarked visual motifs, and celebrity references.${refBlock}`
    );
  }

  if (!activeAttempt.finalJudge.passed) {
    const unsafeTerms = Array.from(
      new Set([
        ...extractUnsafeReferences(activeAttempt.finalJudge.issues),
        ...(brandProfile.banned_words ?? []),
        ...(brandProfile.topics_to_avoid ? [brandProfile.topics_to_avoid] : []),
      ])
    )
      .map((item) => String(item).trim())
      .filter(Boolean)
      .slice(0, 20);

    const fallbackCaptionRaw = sanitizeTextByTerms(activeAttempt.formatted.caption, unsafeTerms);
    const fallbackCaption =
      fallbackCaptionRaw.length >= 60
        ? fallbackCaptionRaw
        : `Fresh campaign concept for ${brandProfile.brand_name}: practical value, clear visual story, and a confident CTA for ${params.platform}.`;
    const fallbackHeadlineRaw = sanitizeTextByTerms(activeAttempt.usedHeadline, unsafeTerms);
    const fallbackHeadline = fallbackHeadlineRaw || `${brandProfile.brand_name} Update`;
    const fallbackHashtags = sanitizeHashtagsByTerms(activeAttempt.formatted.hashtags, unsafeTerms).slice(0, 12);
    const fallbackImageDirection = sanitizeTextByTerms(activeAttempt.generated.imageDirection, unsafeTerms);

    const fallbackBaseImage = await generateImage(fallbackImageDirection, imageDimensionsForPlatform(params.platform));
    let fallbackImageUrl = fallbackBaseImage.url;
    if (generationMode === "with_text" || generationMode === "structured_layout") {
      const fallbackBuffer =
        generationMode === "with_text"
          ? await addTextOverlay(fallbackBaseImage.url, fallbackHeadline, {
              subtitle: fallbackCaption.slice(0, 120),
              cta: activeAttempt.generated.cta ?? ctaText,
              brandName: brandProfile.brand_name,
            })
          : await renderPostImage({
              headline: fallbackHeadline,
              subtext: fallbackCaption.slice(0, 140),
              brandColors: brandProfile.brand_colors ?? [],
              brandLogo: brandProfile.logo_url,
              brandName: brandProfile.brand_name,
              backgroundImageUrl: fallbackBaseImage.url,
              features: featureTags(params.postType, brandProfile.industry, params.platform),
              ctaText,
            });

      const fallbackFilename = `post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
      const { error: fallbackUploadError } = await supabase.storage.from("generated-posts").upload(fallbackFilename, fallbackBuffer, {
        contentType: "image/png",
        upsert: false,
      });
      if (fallbackUploadError) {
        throw new HttpError(500, "Failed to upload image to storage", "STORAGE_UPLOAD_FAILED", {
          reason: fallbackUploadError.message,
        });
      }
      const { data: fallbackUrlData } = supabase.storage.from("generated-posts").getPublicUrl(fallbackFilename);
      fallbackImageUrl = fallbackUrlData.publicUrl;
    }

    const fallbackJudge = await runFinalSafetyJudge({
      platform: params.platform,
      caption: fallbackCaption,
      hashtags: fallbackHashtags,
      imageDirection: fallbackImageDirection,
      trendSummary: trendContext?.summary,
      bannedWords: brandProfile.banned_words,
      topicsToAvoid: brandProfile.topics_to_avoid ? [brandProfile.topics_to_avoid] : [],
    });

    const fallbackHasHigh = fallbackJudge.issues.some((issue) => issue.severity === "high");
    if (!fallbackHasHigh) {
      activeAttempt = {
        ...activeAttempt,
        baseImage: fallbackBaseImage,
        usedHeadline: fallbackHeadline,
        finalImageUrl: fallbackImageUrl,
        formatted: {
          caption: fallbackCaption,
          hashtags: fallbackHashtags,
        },
        generated: {
          ...activeAttempt.generated,
          caption: fallbackCaption,
          headlineText: fallbackHeadline,
          hashtags: fallbackHashtags,
          imageDirection: fallbackImageDirection,
        },
        finalJudge: fallbackJudge,
      };
    }
  }

  if (!activeAttempt.finalJudge.passed) {
    const failedAttemptCostUsd = estimateGenerationCostUsd({
      provider: activeAttempt.baseImage.provider,
      promptLength: activeAttempt.generated.promptUsed.length,
      judgeCalls: 1,
    });

    const failedGenerationId = await persistGenerationRow({
      userId: params.userId,
      brandProfileId: params.brandProfileId,
      trendBriefId: params.trendBriefId,
      platform: params.platform,
      postType: params.postType,
      topic: params.topic,
      tone: params.tone,
      generationMode,
      ctaText,
      parentGenerationId,
      totalLatencyMs: Date.now() - startMs,
      estimatedCostUsd: failedAttemptCostUsd,
      attempt: activeAttempt,
    });

    throw new HttpError(422, "Generated content failed final safety/IP judge", "FINAL_SAFETY_JUDGE_FAILED", {
      issues: activeAttempt.finalJudge.issues,
      rationale: activeAttempt.finalJudge.rationale,
      retried: Boolean(parentGenerationId),
      generationId: failedGenerationId,
    });
  }

  const latencyMs = Date.now() - startMs;
  const activeAttemptCostUsd = estimateGenerationCostUsd({
    provider: activeAttempt.baseImage.provider,
    promptLength: activeAttempt.generated.promptUsed.length,
    judgeCalls: 1,
  });
  const totalEstimatedCostUsd = Number(((parentGenerationId ? estimateGenerationCostUsd({
    provider: firstAttempt.baseImage.provider,
    promptLength: firstAttempt.generated.promptUsed.length,
    judgeCalls: 1,
  }) : 0) + activeAttemptCostUsd).toFixed(6));

  const generationId = await persistGenerationRow({
    userId: params.userId,
    brandProfileId: params.brandProfileId,
    trendBriefId: params.trendBriefId,
    platform: params.platform,
    postType: params.postType,
    topic: params.topic,
    tone: params.tone,
    generationMode,
    ctaText,
    parentGenerationId,
    totalLatencyMs: latencyMs,
    estimatedCostUsd: totalEstimatedCostUsd,
    attempt: activeAttempt,
  });

  await trackUsageEvent({
    userId: params.userId,
    eventType: "post_generated",
    metadata: {
      generationId,
      platform: params.platform,
      generationMode,
      provider: activeAttempt.baseImage.provider,
      retryAttempt: activeAttempt.retryAttempt,
      estimatedCostUsd: totalEstimatedCostUsd,
      parentGenerationId: parentGenerationId ?? null,
    },
  });

  return {
    generationId,
    caption: activeAttempt.formatted.caption,
    hashtags: activeAttempt.formatted.hashtags,
    imageUrl: activeAttempt.finalImageUrl,
    generationMode,
    imageGeneration: {
      provider: activeAttempt.baseImage.provider,
      model: activeAttempt.baseImage.model,
      seed: activeAttempt.generationSeed,
      estimatedCostUsd: totalEstimatedCostUsd,
      latencyMs,
    },
    safetyJudge: activeAttempt.finalJudge,
    usedHeadline: activeAttempt.usedHeadline,
    imageDirection: activeAttempt.generated.imageDirection,
    quality: {
      score: activeAttempt.generated.qualityScore,
      reasons: activeAttempt.generated.qualityReasons,
      strategy: activeAttempt.generated.strategy,
      alternatives: activeAttempt.generated.alternatives,
    },
    delivery: platformDeliveryHints(params.platform),
    trendReferences,
    safety: activeAttempt.safety,
  };
}
