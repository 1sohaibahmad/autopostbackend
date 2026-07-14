import { Router } from "express";
import { env } from "../config/env";

const router = Router();

router.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    version: env.appVersion,
    time: new Date().toISOString(),
  });
});

export default router;
