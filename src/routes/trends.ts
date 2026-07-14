import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { validateRequest } from "../middleware/validate";
import { ingestTrendSignalsSchema, listTrendSignalsQuerySchema } from "../schemas/agenticSchemas";
import { createTrendBriefSchema } from "../schemas/trendSchemas";
import { createTrendAdaptationBrief } from "../services/trendAdaptationService";
import { ingestTrendSignals, listTrendSignals } from "../services/trendSignalService";

const router = Router();

router.post("/brief", requireAuth, validateRequest({ body: createTrendBriefSchema }), async (req, res, next) => {
  try {
    const brief = await createTrendAdaptationBrief({
      userId: req.auth!.user.id,
      brandProfileId: req.body.brandProfileId,
      platform: req.body.platform,
      trendTitle: req.body.trendTitle,
      trendDescription: req.body.trendDescription,
      objective: req.body.objective,
    });
    res.status(201).json({ data: brief });
  } catch (error) {
    next(error);
  }
});

router.post("/signals/ingest", requireAuth, validateRequest({ body: ingestTrendSignalsSchema }), async (req, res, next) => {
  try {
    const result = await ingestTrendSignals(req.auth!.user.id, req.body);
    res.status(201).json({ data: result });
  } catch (error) {
    next(error);
  }
});

router.get("/signals", requireAuth, validateRequest({ query: listTrendSignalsQuerySchema }), async (req, res, next) => {
  try {
    const data = await listTrendSignals(req.auth!.user.id, {
      source: req.query.source as string | undefined,
      limit: Number(req.query.limit),
    });
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

export default router;
