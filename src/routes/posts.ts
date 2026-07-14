import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { validateRequest } from "../middleware/validate";
import { generatePostSchema } from "../schemas/postSchemas";
import { generatePostForUser } from "../services/postGenerationService";

const router = Router();

router.post("/generate", requireAuth, validateRequest({ body: generatePostSchema }), async (req, res, next) => {
  try {
    const generated = await generatePostForUser({
      userId: req.auth!.user.id,
      brandProfileId: req.body.brandProfileId,
      platform: req.body.platform,
      postType: req.body.postType,
      topic: req.body.topic,
      tone: req.body.tone,
      customHeadline: req.body.customHeadline,
      trendBriefId: req.body.trendBriefId,
    });
    res.json(generated);
  } catch (error) {
    next(error);
  }
});

export default router;
