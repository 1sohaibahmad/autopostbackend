import { supabase } from "../lib/supabase";

export type UsageEventType =
  | "trend_brief_generated"
  | "post_generated"
  | "draft_created"
  | "draft_updated"
  | "autopilot_run";

export async function trackUsageEvent(params: {
  userId: string;
  eventType: UsageEventType;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await supabase.from("usage_events").insert({
    user_id: params.userId,
    event_type: params.eventType,
    metadata: params.metadata ?? {},
  });
}

export async function getUsageSummary(userId: string): Promise<Record<string, number>> {
  const { data } = await supabase
    .from("usage_events")
    .select("event_type")
    .eq("user_id", userId)
    .gte("created_at", new Date(new Date().setUTCDate(1)).toISOString());

  const summary: Record<string, number> = {
    trend_brief_generated: 0,
    post_generated: 0,
    draft_created: 0,
    draft_updated: 0,
    autopilot_run: 0,
  };

  (data ?? []).forEach((row: any) => {
    const key = String(row.event_type);
    summary[key] = (summary[key] ?? 0) + 1;
  });

  return summary;
}
