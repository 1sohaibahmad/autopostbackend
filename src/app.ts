import cors from "cors";
import express from "express";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env";
import { openApiDocument } from "./docs/openapi";
import { errorHandler } from "./middleware/errorHandler";
import { notFoundHandler } from "./middleware/notFound";
import { apiRateLimiter } from "./middleware/rateLimiter";
import healthRouter from "./routes/health";
import legacyPostGenerationRouter from "./routes/postGeneration";
import v1Router from "./routes/v1";

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: env.corsOrigin === "*" ? true : env.corsOrigin,
  })
);
app.use(express.json({ limit: "256kb" }));
app.use(apiRateLimiter);

app.use(healthRouter);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));
app.use("/api/v1", v1Router);

// Backward compatibility for current mobile app route.
app.use("/api", legacyPostGenerationRouter);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
