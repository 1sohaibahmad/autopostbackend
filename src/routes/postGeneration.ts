import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { validateRequest } from "../middleware/validate";
import { generatePostResponseSchema, generatePostSchema } from "../schemas/postSchemas";
import { generatePostForUser } from "../services/postGenerationService";

const router = Router();

router.post("/generate-post", requireAuth, validateRequest({ body: generatePostSchema }), async (req, res, next) => {
  try {
    const response = await generatePostForUser({
      userId: req.auth!.user.id,
      brandProfileId: req.body.brandProfileId,
      platform: req.body.platform,
      postType: req.body.postType,
      topic: req.body.topic,
      tone: req.body.tone,
      customHeadline: req.body.customHeadline,
      trendBriefId: req.body.trendBriefId,
      trendSignalIds: req.body.trendSignalIds,
      generationMode: req.body.generationMode,
    });

    res.status(200).json(generatePostResponseSchema.parse(response));
  } catch (err) {
    next(err);
  }
});

export default router;
