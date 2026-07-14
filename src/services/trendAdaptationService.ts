import { HttpError } from "../lib/httpError";
import { supabase } from "../lib/supabase";
import { getBrandProfileForUserById } from "./brandProfileService";
import { generateTrendBrief } from "./textGenService";
import { trackUsageEvent } from "./usageMeteringService";

export async function createTrendAdaptationBrief(params: {
  userId: string;
  brandProfileId: number;
  platform: string;
  trendTitle: string;
  trendDescription: string;
  objective: string;
}) {
  const brandProfile = await getBrandProfileForUserById(params.userId, params.brandProfileId);

  const brief = await generateTrendBrief({
    brandName: brandProfile.brand_name,
    industry: brandProfile.industry,
    targetAudience: brandProfile.target_audience ?? "General audience",
    brandVoice: brandProfile.brand_voice ?? "Professional",
    platform: params.platform,
    trendTitle: params.trendTitle,
    trendDescription: params.trendDescription,
    objective: params.objective,
  });

  const { data, error } = await supabase
    .from("trend_briefs")
    .insert({
      user_id: params.userId,
      brand_profile_id: params.brandProfileId,
      platform: params.platform,
      trend_title: params.trendTitle,
      trend_description: params.trendDescription,
      objective: params.objective,
      summary: brief.summary,
      adaptation_angle: brief.adaptationAngle,
      do_list: brief.doList,
      dont_list: brief.dontList,
      risk_notes: brief.riskNotes,
    })
    .select("*")
    .single();

  if (error) {
    throw new HttpError(500, error.message, "DB_ERROR");
  }

  await trackUsageEvent({
    userId: params.userId,
    eventType: "trend_brief_generated",
    metadata: { briefId: data.id, platform: params.platform },
  });

  return data;
}
