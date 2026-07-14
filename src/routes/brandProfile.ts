import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";
import { validateRequest } from "../middleware/validate";
import { upsertBrandProfileSchema } from "../schemas/brandProfileSchemas";
import { getLatestBrandProfileForUser, upsertLatestBrandProfileForUser } from "../services/brandProfileService";

const router = Router();

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const data = await getLatestBrandProfileForUser(req.auth!.user.id);
    res.json({ data });
  } catch (error) {
    next(error);
  }
});

router.put("/me", requireAuth, validateRequest({ body: upsertBrandProfileSchema }), async (req, res, next) => {
  try {
    const saved = await upsertLatestBrandProfileForUser(req.auth!.user.id, req.body);
    res.json({ data: saved });
  } catch (error) {
    next(error);
  }
});

export default router;
