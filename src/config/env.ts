import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3000),
  appVersion: process.env.APP_VERSION ?? "0.1.0",
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  openAiApiKey: required("OPENAI_API_KEY"),
  replicateApiToken: process.env.REPLICATE_API_TOKEN,
  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  adminApiKey: process.env.ADMIN_API_KEY ?? "",
  trendsWorkerEnabled: (process.env.TRENDS_WORKER_ENABLED ?? "true").toLowerCase() === "true",
  trendsWorkerIntervalMinutes: Math.max(1, Number(process.env.TRENDS_WORKER_INTERVAL_MINUTES ?? 30)),
  get trendsWorkerIntervalMs() {
    return this.trendsWorkerIntervalMinutes * 60 * 1000;
  },
};
