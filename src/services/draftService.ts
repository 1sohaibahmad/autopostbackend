import { HttpError } from "../lib/httpError";
import { supabase } from "../lib/supabase";
import { trackUsageEvent } from "./usageMeteringService";

export async function listDrafts(userId: string, status?: string, limit = 20) {
  let query = supabase
    .from("draft_posts")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    throw new HttpError(500, error.message, "DB_ERROR");
  }
  return data ?? [];
}

export async function createDraft(
  userId: string,
  payload: {
    brandProfileId: number;
    platform: string;
    caption: string;
    hashtags: string[];
    cta: string;
    imageUrl?: string | null;
    status: "draft" | "approved" | "scheduled";
    scheduledAt?: string | null;
  }
) {
  const { data, error } = await supabase
    .from("draft_posts")
    .insert({
      user_id: userId,
      brand_profile_id: payload.brandProfileId,
      platform: payload.platform,
      caption: payload.caption,
      hashtags: payload.hashtags,
      cta: payload.cta,
      image_url: payload.imageUrl ?? null,
      status: payload.status,
      scheduled_at: payload.scheduledAt ?? null,
    })
    .select("*")
    .single();

  if (error) {
    throw new HttpError(500, error.message, "DB_ERROR");
  }

  await trackUsageEvent({
    userId,
    eventType: "draft_created",
    metadata: { draftId: data.id, status: payload.status },
  });

  return data;
}

export async function updateDraft(
  userId: string,
  id: number,
  payload: Partial<{
    platform: string;
    caption: string;
    hashtags: string[];
    cta: string;
    imageUrl: string | null;
    status: "draft" | "approved" | "scheduled";
    scheduledAt: string | null;
  }>
) {
  const updatePayload: Record<string, unknown> = {};
  if (payload.platform !== undefined) updatePayload.platform = payload.platform;
  if (payload.caption !== undefined) updatePayload.caption = payload.caption;
  if (payload.hashtags !== undefined) updatePayload.hashtags = payload.hashtags;
  if (payload.cta !== undefined) updatePayload.cta = payload.cta;
  if (payload.imageUrl !== undefined) updatePayload.image_url = payload.imageUrl;
  if (payload.status !== undefined) updatePayload.status = payload.status;
  if (payload.scheduledAt !== undefined) updatePayload.scheduled_at = payload.scheduledAt;

  const { data, error } = await supabase
    .from("draft_posts")
    .update(updatePayload)
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new HttpError(500, error.message, "DB_ERROR");
  }

  if (!data) {
    throw new HttpError(404, "Draft not found", "DRAFT_NOT_FOUND");
  }

  await trackUsageEvent({
    userId,
    eventType: "draft_updated",
    metadata: { draftId: data.id, status: data.status },
  });

  return data;
}

export async function deleteDraft(userId: string, id: number): Promise<void> {
  const { error } = await supabase.from("draft_posts").delete().eq("id", id).eq("user_id", userId);
  if (error) {
    throw new HttpError(500, error.message, "DB_ERROR");
  }
}
