import { HttpError } from "../lib/httpError";
import { supabase } from "../lib/supabase";
import { createDraft } from "./draftService";
import { generatePostForUser } from "./postGenerationService";
import { createTrendAdaptationBrief } from "./trendAdaptationService";
import { discoverTrendSignals, ingestTrendSignals, listTrendMatches, recomputeTrendMatches } from "./trendSignalService";
import { trackUsageEvent } from "./usageMeteringService";

export async function upsertAutopilotSettings(
  userId: string,
  payload: {
    brandProfileId: number;
    enabled: boolean;
    platforms: string[];
    minRelevanceScore: number;
    maxDraftsPerRun: number;
    postType: string;
  }
) {
  const { data: existing } = await supabase
    .from("autopilot_settings")
    .select("id")
    .eq("user_id", userId)
    .eq("brand_profile_id", payload.brandProfileId)
    .maybeSingle();

  const row = {
    user_id: userId,
    brand_profile_id: payload.brandProfileId,
    enabled: payload.enabled,
    platforms: payload.platforms,
    min_relevance_score: payload.minRelevanceScore,
    max_drafts_per_run: payload.maxDraftsPerRun,
    post_type: payload.postType,
  };

  if (existing) {
    const { data, error } = await supabase.from("autopilot_settings").update(row).eq("id", existing.id).select("*").single();
    if (error) throw new HttpError(500, error.message, "DB_ERROR");
    return data;
  }

  const { data, error } = await supabase.from("autopilot_settings").insert(row).select("*").single();
  if (error) throw new HttpError(500, error.message, "DB_ERROR");
  return data;
}

export async function runAutopilot(params: {
  userId: string;
  brandProfileId: number;
  platform: "instagram" | "facebook" | "linkedin" | "x" | "tiktok" | "pinterest";
  maxDrafts: number;
  postType:
    | "product_promotion"
    | "trend_based"
    | "infographic"
    | "how_to"
    | "review_testimonial"
    | "comparison"
    | "engagement"
    | "holiday_occasion";
}) {
  const { data: settings } = await supabase
    .from("autopilot_settings")
    .select("*")
    .eq("user_id", params.userId)
    .eq("brand_profile_id", params.brandProfileId)
    .maybeSingle();

  const minScore = settings?.min_relevance_score ?? 70;
  const effectiveMaxDrafts = Math.min(params.maxDrafts, settings?.max_drafts_per_run ?? params.maxDrafts);

  if (settings && settings.enabled === false) {
    throw new HttpError(409, "Autopilot is disabled in settings", "AUTOPILOT_DISABLED");
  }

  const { data: run, error: runError } = await supabase
    .from("autopilot_runs")
    .insert({
      user_id: params.userId,
      brand_profile_id: params.brandProfileId,
      platform: params.platform,
      status: "running",
      max_drafts: effectiveMaxDrafts,
    })
    .select("*")
    .single();

  if (runError) {
    throw new HttpError(500, runError.message, "DB_ERROR");
  }

  const discovered = await discoverTrendSignals({
    userId: params.userId,
    limit: 60,
    platform: params.platform,
    language: "en",
    region: "global",
    brandProfileId: params.brandProfileId,
  });

  const bySource = new Map<string, Array<(typeof discovered.data)[number]>>();
  for (const signal of discovered.data) {
    const list = bySource.get(signal.source) ?? [];
    list.push(signal);
    bySource.set(signal.source, list);
  }

  let ingestedTotal = 0;
  for (const [source, signals] of bySource.entries()) {
    const ingested = await ingestTrendSignals(params.userId, {
      source,
      signals: signals.map((signal) => ({
        externalId: signal.externalId,
        title: signal.title,
        description: signal.description,
        url: signal.url,
        tags: signal.tags,
        platformHints: signal.platformHints,
        language: signal.language,
        region: signal.region,
        velocityScore: signal.velocityScore,
        publishedAt: signal.publishedAt,
      })),
    });
    ingestedTotal += ingested.total;
  }

  await recomputeTrendMatches({
    userId: params.userId,
    brandProfileId: params.brandProfileId,
    platform: params.platform,
    limitSignals: 150,
  });

  const candidates = await listTrendMatches({
    userId: params.userId,
    brandProfileId: params.brandProfileId,
    platform: params.platform,
    minScore,
    limit: 20,
  });

  const fallbackMatches = discovered.data
    .filter((signal) => signal.brandSafetyRating !== "avoid")
    .slice(0, Math.max(effectiveMaxDrafts, 1))
    .map((signal) => ({
      id: `fallback-${signal.externalId}`,
      relevance_score: signal.relevanceScore,
      trend_signals: {
        id: 0,
        title: signal.title,
        description: signal.description,
      },
    }));

  const topMatches = (candidates.length ? candidates : (fallbackMatches as any[])).slice(0, effectiveMaxDrafts);
  const createdDrafts: Array<{ draftId: number; signalId: number; score: number }> = [];
  const errors: string[] = [];

  for (const match of topMatches) {
    try {
      const signal = (match as any).trend_signals;
      if (!signal) continue;

      const brief = await createTrendAdaptationBrief({
        userId: params.userId,
        brandProfileId: params.brandProfileId,
        platform: params.platform,
        trendTitle: signal.title,
        trendDescription: signal.description,
        objective: "engagement",
      });

      const generated = await generatePostForUser({
        userId: params.userId,
        brandProfileId: params.brandProfileId,
        platform: params.platform,
        postType: params.postType,
        topic: signal.title,
        tone: "match_brand_voice",
        trendBriefId: brief.id,
      });

      const draft = await createDraft(params.userId, {
        brandProfileId: params.brandProfileId,
        platform: params.platform,
        caption: generated.caption,
        hashtags: generated.hashtags,
        cta: "",
        imageUrl: generated.imageUrl,
        status: "draft",
      });

      if (!String((match as any).id).startsWith("fallback-")) {
        await supabase.from("trend_relevance_matches").update({ status: "consumed" }).eq("id", (match as any).id);
      }

      createdDrafts.push({
        draftId: draft.id,
        signalId: signal.id,
        score: Number((match as any).relevance_score ?? 0),
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Unknown autopilot error");
    }
  }

  const status = errors.length ? (createdDrafts.length ? "partial" : "failed") : "completed";
  const { error: updateRunError } = await supabase
    .from("autopilot_runs")
    .update({
      status,
      created_drafts_count: createdDrafts.length,
      errors,
      completed_at: new Date().toISOString(),
    })
    .eq("id", run.id)
    .eq("user_id", params.userId);

  if (updateRunError) {
    throw new HttpError(500, updateRunError.message, "DB_ERROR");
  }

  await trackUsageEvent({
    userId: params.userId,
    eventType: "autopilot_run",
    metadata: {
      runId: run.id,
      platform: params.platform,
      createdDrafts: createdDrafts.length,
      status,
    },
  });

  return {
    runId: run.id,
    status,
    discovered: discovered.data.length,
    ingested: ingestedTotal,
    evaluated: candidates.length,
    createdDrafts,
    errors,
  };
}
