import { Router } from "express";
import autopilotRouter from "./autopilot";
import authRouter from "./auth";
import brandProfileRouter from "./brandProfile";
import draftsRouter from "./drafts";
import postsRouter from "./posts";
import trendsRouter from "./trends";
import usageRouter from "./usage";

const v1Router = Router();

v1Router.use("/auth", authRouter);
v1Router.use("/brand-profiles", brandProfileRouter);
v1Router.use("/trends", trendsRouter);
v1Router.use("/autopilot", autopilotRouter);
v1Router.use("/posts", postsRouter);
v1Router.use("/drafts", draftsRouter);
v1Router.use("/usage", usageRouter);

export default v1Router;
