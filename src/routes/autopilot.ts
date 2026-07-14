import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { validateRequest } from "../middleware/validate";
import {
  listMatchesQuerySchema,
  recomputeMatchesSchema,
  runAutopilotSchema,
  upsertAutopilotSettingsSchema,
} from "../schemas/agenticSchemas";
import { runAutopilot, upsertAutopilotSettings } from "../services/autopilotService";
import { listTrendMatches, recomputeTrendMatches } from "../services/trendSignalService";

const router = Router();

router.put("/settings", requireAuth, validateRequest({ body: upsertAutopilotSettingsSchema }), async (req, res, next) => {
  try {
    const data = await upsertAutopilotSettings(req.auth!.user.id, req.body);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

router.post("/matches/recompute", requireAuth, validateRequest({ body: recomputeMatchesSchema }), async (req, res, next) => {
  try {
    const data = await recomputeTrendMatches({
      userId: req.auth!.user.id,
      brandProfileId: req.body.brandProfileId,
      platform: req.body.platform,
      limitSignals: req.body.limitSignals,
    });
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

router.get("/matches", requireAuth, validateRequest({ query: listMatchesQuerySchema }), async (req, res, next) => {
  try {
    const data = await listTrendMatches({
      userId: req.auth!.user.id,
      brandProfileId: Number(req.query.brandProfileId),
      platform: String(req.query.platform),
      minScore: Number(req.query.minScore),
      limit: Number(req.query.limit),
    });
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

router.post("/run", requireAuth, validateRequest({ body: runAutopilotSchema }), async (req, res, next) => {
  try {
    const data = await runAutopilot({
      userId: req.auth!.user.id,
      brandProfileId: req.body.brandProfileId,
      platform: req.body.platform,
      maxDrafts: req.body.maxDrafts,
      postType: req.body.postType,
    });
    res.status(201).json({ data });
  } catch (error) {
    next(error);
  }
});

export default router;
