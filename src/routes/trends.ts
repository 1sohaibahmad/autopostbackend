import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { validateRequest } from "../middleware/validate";
import {
  discoverTrendSignalsQuerySchema,
  extractImageContextSchema,
  ingestTrendSignalsSchema,
  listTrendSignalsQuerySchema,
  trendExamplesQuerySchema,
} from "../schemas/agenticSchemas";
import { createTrendBriefSchema } from "../schemas/trendSchemas";
import { createTrendAdaptationBrief } from "../services/trendAdaptationService";
import { discoverTrendSignals, fetchTrendExamples, ingestTrendSignals, listTrendSignals } from "../services/trendSignalService";
import { extractImageContentContext } from "../services/imageInsightService";

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
      platform: req.query.platform as string | undefined,
      minVelocity: req.query.minVelocity ? Number(req.query.minVelocity) : undefined,
      q: req.query.q as string | undefined,
      limit: Number(req.query.limit),
    });
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

router.get("/signals/discover", requireAuth, validateRequest({ query: discoverTrendSignalsQuerySchema }), async (req, res, next) => {
  try {
    const data = await discoverTrendSignals({
      userId: req.auth!.user.id,
      limit: Number(req.query.limit),
      niche: req.query.niche as string | undefined,
      platform: req.query.platform as string | undefined,
      language: String(req.query.language),
      region: String(req.query.region),
      brandProfileId: req.query.brandProfileId ? Number(req.query.brandProfileId) : undefined,
    });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.post("/extract-image-context", requireAuth, validateRequest({ body: extractImageContextSchema }), async (req, res, next) => {
  try {
    const data = await extractImageContentContext({
      imageUrl: req.body.imageUrl,
      focus: req.body.focus,
    });
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

router.get("/examples", requireAuth, validateRequest({ query: trendExamplesQuerySchema }), async (req, res, next) => {
  try {
    const data = await fetchTrendExamples({
      trendTitle: String(req.query.trendTitle),
      platform: req.query.platform as string | undefined,
      limit: Number(req.query.limit),
    });
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

export default router;
