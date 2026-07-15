import { env } from "../config/env";
import { supabase } from "../lib/supabase";
import { discoverTrendSignals, ingestTrendSignals, recomputeTrendMatches } from "../services/trendSignalService";

type WorkerStats = {
  discovered: number;
  ingested: number;
  evaluated: number;
  runs: number;
};

const workerState: {
  enabled: boolean;
  intervalMs: number;
  running: boolean;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastError: string | null;
  lastStats: WorkerStats | null;
  timer: NodeJS.Timeout | null;
} = {
  enabled: env.trendsWorkerEnabled,
  intervalMs: env.trendsWorkerIntervalMs,
  running: false,
  lastStartedAt: null,
  lastCompletedAt: null,
  lastError: null,
  lastStats: null,
  timer: null,
};

export function getTrendIngestionWorkerStatus() {
  return {
    enabled: workerState.enabled,
    intervalMs: workerState.intervalMs,
    running: workerState.running,
    lastStartedAt: workerState.lastStartedAt,
    lastCompletedAt: workerState.lastCompletedAt,
    lastError: workerState.lastError,
    lastStats: workerState.lastStats,
  };
}

export async function runTrendIngestionCycle(triggeredBy: "timer" | "manual" | "startup" = "timer"): Promise<WorkerStats> {
  if (workerState.running) {
    return workerState.lastStats ?? { discovered: 0, ingested: 0, evaluated: 0, runs: 0 };
  }

  workerState.running = true;
  workerState.lastStartedAt = new Date().toISOString();
  workerState.lastError = null;

  const stats: WorkerStats = { discovered: 0, ingested: 0, evaluated: 0, runs: 0 };

  try {
    const { data: settingsRows, error: settingsError } = await supabase
      .from("autopilot_settings")
      .select("user_id,brand_profile_id,platforms,enabled,min_relevance_score")
      .eq("enabled", true)
      .limit(80);

    if (settingsError) {
      throw new Error(settingsError.message);
    }

    for (const row of settingsRows ?? []) {
      const platforms = Array.isArray(row.platforms) ? row.platforms.map((value) => String(value)).slice(0, 6) : [];
      for (const platform of platforms) {
        const { data: runRecord } = await supabase
          .from("trend_ingestion_runs")
          .insert({
            user_id: row.user_id,
            brand_profile_id: row.brand_profile_id,
            platform,
            status: "running",
          })
          .select("id")
          .single();

        try {
          const discovered = await discoverTrendSignals({
            userId: row.user_id,
            limit: 25,
            platform,
            language: "en",
            region: "global",
            brandProfileId: Number(row.brand_profile_id),
          });
          stats.discovered += discovered.data.length;

          const sourceBuckets = new Map<string, typeof discovered.data>();
          for (const signal of discovered.data) {
            const bucket = sourceBuckets.get(signal.source) ?? [];
            bucket.push(signal);
            sourceBuckets.set(signal.source, bucket);
          }

          let ingestedForRun = 0;
          for (const [source, signals] of sourceBuckets.entries()) {
            const ingested = await ingestTrendSignals(row.user_id, {
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
            ingestedForRun += ingested.total;
          }
          stats.ingested += ingestedForRun;

          const recomputed = await recomputeTrendMatches({
            userId: row.user_id,
            brandProfileId: Number(row.brand_profile_id),
            platform,
            limitSignals: 150,
          });
          stats.evaluated += recomputed.evaluated;
          stats.runs += 1;

          if (runRecord?.id) {
            await supabase
              .from("trend_ingestion_runs")
              .update({
                status: "completed",
                discovered_count: discovered.data.length,
                ingested_count: ingestedForRun,
                evaluated_count: recomputed.evaluated,
                completed_at: new Date().toISOString(),
              })
              .eq("id", runRecord.id);
          }
        } catch (runError) {
          if (runRecord?.id) {
            await supabase
              .from("trend_ingestion_runs")
              .update({
                status: "failed",
                error: runError instanceof Error ? runError.message.slice(0, 500) : "Unknown run error",
                completed_at: new Date().toISOString(),
              })
              .eq("id", runRecord.id);
          }
        }
      }
    }

    workerState.lastCompletedAt = new Date().toISOString();
    workerState.lastStats = stats;
    workerState.lastError = null;
    return stats;
  } catch (error) {
    workerState.lastError = error instanceof Error ? error.message : "Unknown worker error";
    workerState.lastCompletedAt = new Date().toISOString();
    throw error;
  } finally {
    workerState.running = false;
    if (triggeredBy !== "timer") {
      console.log(`[trend-worker] completed trigger=${triggeredBy}`);
    }
  }
}

export function startTrendIngestionWorker(): void {
  if (!workerState.enabled || workerState.timer) {
    return;
  }

  workerState.timer = setInterval(() => {
    runTrendIngestionCycle("timer").catch((error) => {
      workerState.lastError = error instanceof Error ? error.message : "Unknown worker error";
    });
  }, workerState.intervalMs);

  setTimeout(() => {
    runTrendIngestionCycle("startup").catch((error) => {
      workerState.lastError = error instanceof Error ? error.message : "Unknown worker error";
    });
  }, 3000);

  console.log(`[trend-worker] started interval=${workerState.intervalMs}ms`);
}
