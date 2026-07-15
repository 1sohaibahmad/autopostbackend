import app from "./app";
import { env } from "./config/env";
import { startTrendIngestionWorker } from "./workers/trendIngestionWorker";

startTrendIngestionWorker();

app.listen(env.port, () => {
  console.log(`Server running on port ${env.port}`);
});
