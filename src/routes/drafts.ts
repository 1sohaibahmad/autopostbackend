import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/requireAuth";
import { validateRequest } from "../middleware/validate";
import { createDraftSchema, listDraftQuerySchema, updateDraftSchema } from "../schemas/draftSchemas";
import { createDraft, deleteDraft, listDrafts, updateDraft } from "../services/draftService";

const router = Router();

router.get("/", requireAuth, validateRequest({ query: listDraftQuerySchema }), async (req, res, next) => {
  try {
    const drafts = await listDrafts(req.auth!.user.id, req.query.status as string | undefined, Number(req.query.limit));
    res.json({ data: drafts });
  } catch (error) {
    next(error);
  }
});

router.post("/", requireAuth, validateRequest({ body: createDraftSchema }), async (req, res, next) => {
  try {
    const draft = await createDraft(req.auth!.user.id, req.body);
    res.status(201).json({ data: draft });
  } catch (error) {
    next(error);
  }
});

router.patch(
  "/:id",
  requireAuth,
  validateRequest({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: updateDraftSchema.omit({ id: true }),
  }),
  async (req, res, next) => {
    try {
      const updated = await updateDraft(req.auth!.user.id, Number(req.params.id), req.body);
      res.json({ data: updated });
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  "/:id",
  requireAuth,
  validateRequest({ params: z.object({ id: z.coerce.number().int().positive() }) }),
  async (req, res, next) => {
    try {
      await deleteDraft(req.auth!.user.id, Number(req.params.id));
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

export default router;
