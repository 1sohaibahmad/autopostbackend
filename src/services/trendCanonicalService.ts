import { supabase } from "../lib/supabase";

type CanonicalSignalInput = {
  source: string;
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
};

function normalizeTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .slice(0, 7)
    .join("-")
    .slice(0, 90);
}

export async function canonicalizeSignalsForUser(userId: string, signals: CanonicalSignalInput[]): Promise<void> {
  for (const signal of signals.slice(0, 80)) {
    const clusterKey = normalizeTitleKey(signal.title) || `fallback-${signal.externalId.slice(0, 32)}`;

    const { data: clusterExisting } = await supabase
      .from("trend_clusters")
      .select("id,tags")
      .eq("user_id", userId)
      .eq("cluster_key", clusterKey)
      .maybeSingle();

    let clusterId = Number(clusterExisting?.id ?? 0);
    if (!clusterId) {
      const { data: createdCluster, error: createClusterError } = await supabase
        .from("trend_clusters")
        .insert({
          user_id: userId,
          cluster_key: clusterKey,
          canonical_title: signal.title,
          tags: signal.tags.slice(0, 20),
        })
        .select("id")
        .single();
      if (createClusterError) continue;
      clusterId = Number(createdCluster.id);
    } else {
      const mergedTags = Array.from(new Set([...(clusterExisting?.tags ?? []), ...signal.tags])).slice(0, 20);
      await supabase.from("trend_clusters").update({ tags: mergedTags }).eq("id", clusterId).eq("user_id", userId);
    }

    const { data: trendExisting } = await supabase
      .from("trends")
      .select("id,source_count")
      .eq("user_id", userId)
      .eq("cluster_id", clusterId)
      .maybeSingle();

    let trendId = Number(trendExisting?.id ?? 0);
    const confidenceScore = Math.round(Math.min(100, Math.max(35, signal.velocityScore * 0.75 + (signal.platformHints.length > 1 ? 12 : 0))));

    if (!trendId) {
      const { data: createdTrend, error: createTrendError } = await supabase
        .from("trends")
        .insert({
          user_id: userId,
          cluster_id: clusterId,
          title: signal.title,
          summary: signal.description.slice(0, 1000),
          source_count: 1,
          momentum_score: signal.velocityScore,
          confidence_score: confidenceScore,
          latest_signal_at: signal.publishedAt ?? new Date().toISOString(),
          platform_hints: signal.platformHints,
        })
        .select("id")
        .single();
      if (createTrendError) continue;
      trendId = Number(createdTrend.id);
    } else {
      await supabase
        .from("trends")
        .update({
          title: signal.title,
          summary: signal.description.slice(0, 1000),
          source_count: Number(trendExisting?.source_count ?? 0) + 1,
          momentum_score: signal.velocityScore,
          confidence_score: confidenceScore,
          latest_signal_at: signal.publishedAt ?? new Date().toISOString(),
          platform_hints: signal.platformHints,
        })
        .eq("id", trendId)
        .eq("user_id", userId);
    }

    await supabase.from("trend_source_signals").upsert(
      {
        user_id: userId,
        trend_id: trendId,
        source: signal.source,
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
      },
      { onConflict: "user_id,source,external_id" }
    );

    for (const windowHours of [2, 12, 48]) {
      const delta = Number((signal.velocityScore - Math.max(0, 80 - windowHours)).toFixed(2));
      await supabase.from("trend_momentum_windows").upsert(
        {
          user_id: userId,
          trend_id: trendId,
          window_hours: windowHours,
          signal_count: 1,
          avg_velocity: signal.velocityScore,
          momentum_delta: delta,
          computed_at: new Date().toISOString(),
        },
        { onConflict: "user_id,trend_id,window_hours" }
      );
    }

    await supabase.from("trend_embeddings").upsert(
      {
        user_id: userId,
        trend_id: trendId,
        embedding_model: "keyword-bag-v1",
        embedding: signal.tags.slice(0, 32),
      },
      { onConflict: "user_id,trend_id,embedding_model" }
    );
  }
}
