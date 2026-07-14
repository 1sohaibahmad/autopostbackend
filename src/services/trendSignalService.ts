import { HttpError } from "../lib/httpError";
import { supabase } from "../lib/supabase";
import { getBrandProfileForUserById } from "./brandProfileService";

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3)
  );
}

function overlapScore(a: Set<string>, b: Set<string>): number {
  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap += 1;
  }
  if (a.size === 0) return 0;
  return Math.round((overlap / a.size) * 100);
}

export async function ingestTrendSignals(
  userId: string,
  payload: {
    source: string;
    signals: Array<{
      externalId: string;
      title: string;
      description: string;
      url?: string;
      tags: string[];
      platformHints: string[];
      language: string;
      region: string;
      velocityScore: number;
      publishedAt?: string;
    }>;
  }
) {
  let inserted = 0;
  let updated = 0;

  for (const signal of payload.signals) {
    const row = {
      user_id: userId,
      source: payload.source,
      external_id: signal.externalId,
      title: signal.title,
      description: signal.description,
      url: signal.url ?? null,
      tags: signal.tags,
      platform_hints: signal.platformHints,
      language: signal.language,
      region: signal.region,
      velocity_score: signal.velocityScore,
      published_at: signal.publishedAt ?? null,
    };

    const { data: existing, error: findError } = await supabase
      .from("trend_signals")
      .select("id")
      .eq("user_id", userId)
      .eq("source", payload.source)
      .eq("external_id", signal.externalId)
      .maybeSingle();

    if (findError) {
      throw new HttpError(500, findError.message, "DB_ERROR");
    }

    if (existing) {
      const { error } = await supabase.from("trend_signals").update(row).eq("id", existing.id).eq("user_id", userId);
      if (error) {
        throw new HttpError(500, error.message, "DB_ERROR");
      }
      updated += 1;
    } else {
      const { error } = await supabase.from("trend_signals").insert(row);
      if (error) {
        throw new HttpError(500, error.message, "DB_ERROR");
      }
      inserted += 1;
    }
  }

  return { inserted, updated, total: payload.signals.length };
}

export async function listTrendSignals(userId: string, options: { source?: string; limit: number }) {
  let query = supabase
    .from("trend_signals")
    .select("*")
    .eq("user_id", userId)
    .order("velocity_score", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(options.limit);

  if (options.source) {
    query = query.eq("source", options.source);
  }

  const { data, error } = await query;
  if (error) {
    throw new HttpError(500, error.message, "DB_ERROR");
  }
  return data ?? [];
}

export async function recomputeTrendMatches(params: {
  userId: string;
  brandProfileId: number;
  platform: string;
  limitSignals: number;
}) {
  const brand = await getBrandProfileForUserById(params.userId, params.brandProfileId);
  const brandContext = [
    brand.brand_name,
    brand.industry,
    brand.target_audience ?? "",
    brand.brand_voice ?? "",
    ...(brand.products ?? []).map((p) => `${p.name} ${p.description ?? ""}`),
  ].join(" ");
  const brandTokens = tokenize(brandContext);

  const { data: signals, error } = await supabase
    .from("trend_signals")
    .select("*")
    .eq("user_id", params.userId)
    .order("velocity_score", { ascending: false })
    .limit(params.limitSignals);

  if (error) {
    throw new HttpError(500, error.message, "DB_ERROR");
  }

  const computed = (signals ?? []).map((signal: any) => {
    const signalTokens = tokenize(`${signal.title} ${signal.description} ${(signal.tags ?? []).join(" ")}`);
    const semantic = overlapScore(brandTokens, signalTokens);
    const platformBoost = (signal.platform_hints ?? []).includes(params.platform) ? 12 : 0;
    const velocity = Math.min(100, Math.max(0, Number(signal.velocity_score) || 0));
    const score = Math.round(Math.min(100, semantic * 0.65 + velocity * 0.25 + platformBoost));

    return {
      signal,
      score,
      reasons: [
        `Semantic overlap: ${semantic}`,
        `Velocity score: ${velocity}`,
        `Platform hint boost: ${platformBoost}`,
      ],
    };
  });

  for (const match of computed) {
    const payload = {
      user_id: params.userId,
      brand_profile_id: params.brandProfileId,
      signal_id: match.signal.id,
      platform: params.platform,
      relevance_score: match.score,
      reasons: match.reasons,
      status: "candidate",
    };

    const { data: existing } = await supabase
      .from("trend_relevance_matches")
      .select("id")
      .eq("user_id", params.userId)
      .eq("brand_profile_id", params.brandProfileId)
      .eq("signal_id", match.signal.id)
      .eq("platform", params.platform)
      .maybeSingle();

    if (existing) {
      await supabase.from("trend_relevance_matches").update(payload).eq("id", existing.id);
    } else {
      await supabase.from("trend_relevance_matches").insert(payload);
    }
  }

  const sorted = computed.sort((a, b) => b.score - a.score);
  return {
    evaluated: computed.length,
    topScore: sorted[0]?.score ?? 0,
    matches: sorted,
  };
}

export async function listTrendMatches(params: {
  userId: string;
  brandProfileId: number;
  platform: string;
  minScore: number;
  limit: number;
}) {
  const { data, error } = await supabase
    .from("trend_relevance_matches")
    .select("*, trend_signals(*)")
    .eq("user_id", params.userId)
    .eq("brand_profile_id", params.brandProfileId)
    .eq("platform", params.platform)
    .gte("relevance_score", params.minScore)
    .order("relevance_score", { ascending: false })
    .limit(params.limit);

  if (error) {
    throw new HttpError(500, error.message, "DB_ERROR");
  }
  return data ?? [];
}
