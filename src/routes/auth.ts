import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();

router.get("/me", requireAuth, (req, res) => {
  const user = req.auth!.user;
  res.json({
    id: user.id,
    email: user.email,
    app_metadata: user.app_metadata,
    user_metadata: user.user_metadata,
  });
});

export default router;
