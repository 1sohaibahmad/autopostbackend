import { Router } from "express";
import { supabase } from "../services/supabaseService";
import { generateCaption } from "../services/textGenService";
import { generateImage } from "../services/imageGenService";
import { renderPostImage } from "../services/templateRenderService";

const router = Router();

router.post("/generate-post", async (req, res) => {
  try {
    const { brandProfileId, platform, postType, topic, tone, customHeadline } = req.body;

    if (!brandProfileId || !platform || !postType) {
      res.status(400).json({ error: "brandProfileId, platform, and postType are required" });
      return;
    }

    const { data: brandProfile, error } = await supabase
      .from("brand_profiles")
      .select("*")
      .eq("id", brandProfileId)
      .single();

    if (error || !brandProfile) {
      res.status(404).json({ error: "Brand profile not found" });
      return;
    }

    const generated = await generateCaption(brandProfile, platform, postType, topic, tone);
    const backgroundImageUrl = await generateImage(generated.imageDirection);
    const usedHeadline = customHeadline?.trim() || generated.headlineText;

    const imageBuffer = await renderPostImage({
      headline: usedHeadline,
      subtext: generated.caption.slice(0, 120),
      brandColors: brandProfile.brand_colors ?? [],
      brandLogo: brandProfile.logo_url,
      brandName: brandProfile.brand_name,
      backgroundImageUrl,
    });

    const filename = `post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;

    const { error: uploadError } = await supabase.storage
      .from("generated-posts")
      .upload(filename, imageBuffer, {
        contentType: "image/png",
        upsert: false,
      });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      throw new Error("Failed to upload image to storage");
    }

    const { data: urlData } = supabase.storage
      .from("generated-posts")
      .getPublicUrl(filename);

    res.status(200).json({
      caption: generated.caption,
      hashtags: generated.hashtags,
      imageUrl: urlData.publicUrl,
      usedHeadline,
      imageDirection: generated.imageDirection,
    });
  } catch (err) {
    console.error("Error generating post:", err);
    res.status(500).json({ error: "Failed to generate post" });
  }
});

export default router;
