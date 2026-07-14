import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import postGenerationRouter from "./routes/postGeneration";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api", postGenerationRouter);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
