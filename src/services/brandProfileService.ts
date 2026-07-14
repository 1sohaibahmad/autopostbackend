import { HttpError } from "../lib/httpError";
import { supabase } from "../lib/supabase";

export interface BrandProfileRow {
  id: number;
  user_id: string;
  brand_name: string;
  industry: string;
  target_audience: string | null;
  brand_voice: string | null;
  logo_url: string | null;
  brand_colors: string[];
  website_url: string | null;
  products: Array<{ name: string; description: string }>;
  topics_to_avoid: string | null;
  banned_words: string[];
  preferred_platforms: string[];
  created_at: string;
  updated_at: string;
}

export interface UpsertBrandProfileInput {
  brand_name: string;
  industry: string;
  target_audience?: string | null;
  brand_voice?: string | null;
  logo_url?: string | null;
  brand_colors?: string[];
  website_url?: string | null;
  products?: Array<{ name: string; description: string }>;
  topics_to_avoid?: string | null;
  banned_words?: string[];
  preferred_platforms?: string[];
}

function toBrandProfileRow(raw: any): BrandProfileRow {
  return {
    id: Number(raw.id),
    user_id: String(raw.user_id),
    brand_name: String(raw.brand_name),
    industry: String(raw.industry),
    target_audience: raw.target_audience ?? null,
    brand_voice: raw.brand_voice ?? null,
    logo_url: raw.logo_url ?? null,
    brand_colors: Array.isArray(raw.brand_colors) ? raw.brand_colors : [],
    website_url: raw.website_url ?? null,
    products: Array.isArray(raw.products) ? raw.products : [],
    topics_to_avoid: raw.topics_to_avoid ?? null,
    banned_words: Array.isArray(raw.banned_words) ? raw.banned_words : [],
    preferred_platforms: Array.isArray(raw.preferred_platforms) ? raw.preferred_platforms : [],
    created_at: String(raw.created_at),
    updated_at: String(raw.updated_at),
  };
}

export async function getLatestBrandProfileForUser(userId: string): Promise<BrandProfileRow | null> {
  const { data, error } = await supabase
    .from("brand_profiles")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, error.message, "DB_ERROR");
  }

  if (!data) {
    return null;
  }

  return toBrandProfileRow(data);
}

export async function getBrandProfileForUserById(userId: string, id: number): Promise<BrandProfileRow> {
  const { data, error } = await supabase
    .from("brand_profiles")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, error.message, "DB_ERROR");
  }

  if (!data) {
    throw new HttpError(404, "Brand profile not found", "BRAND_PROFILE_NOT_FOUND");
  }

  return toBrandProfileRow(data);
}

export async function upsertLatestBrandProfileForUser(
  userId: string,
  payload: UpsertBrandProfileInput
): Promise<BrandProfileRow> {
  const latest = await getLatestBrandProfileForUser(userId);

  const normalizedPayload = {
    brand_name: payload.brand_name,
    industry: payload.industry,
    target_audience: payload.target_audience ?? null,
    brand_voice: payload.brand_voice ?? null,
    logo_url: payload.logo_url ?? null,
    brand_colors: payload.brand_colors ?? [],
    website_url: payload.website_url ?? null,
    products: payload.products ?? [],
    topics_to_avoid: payload.topics_to_avoid ?? null,
    banned_words: payload.banned_words ?? [],
    preferred_platforms: payload.preferred_platforms ?? [],
  };

  if (latest) {
    const { data, error } = await supabase
      .from("brand_profiles")
      .update(normalizedPayload)
      .eq("id", latest.id)
      .eq("user_id", userId)
      .select("*")
      .single();

    if (error) {
      throw new HttpError(500, error.message, "DB_ERROR");
    }

    return toBrandProfileRow(data);
  }

  const { data, error } = await supabase
    .from("brand_profiles")
    .insert({
      user_id: userId,
      ...normalizedPayload,
    })
    .select("*")
    .single();

  if (error) {
    throw new HttpError(500, error.message, "DB_ERROR");
  }

  return toBrandProfileRow(data);
}
