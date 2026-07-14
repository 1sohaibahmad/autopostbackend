import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { getUsageSummary } from "../services/usageMeteringService";

const router = Router();

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const summary = await getUsageSummary(req.auth!.user.id);
    res.json({ data: summary });
  } catch (error) {
    next(error);
  }
});

export default router;
