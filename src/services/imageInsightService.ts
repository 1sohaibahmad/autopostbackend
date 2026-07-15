import { falCompletion } from "./falTextService";
import { env } from "../config/env";

export async function extractImageContentContext(params: { imageUrl: string; focus?: string }) {
  const focus = params.focus?.trim() || "Extract social-content-relevant details for post generation.";

  try {
    const prompt = `${focus}\nAnalyze the image at this URL: ${params.imageUrl}\nReturn only JSON with keys: summary, objects, textDetected, colors, mood, contentIdeas (max 3).`;

    const raw = await falCompletion(prompt, {
      model: "google/gemini-2.5-flash-lite",
      temperature: 0.2,
      timeoutMs: 12000,
    });

    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```/, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(cleaned) as {
      summary?: string;
      objects?: string[];
      textDetected?: string[];
      colors?: string[];
      mood?: string;
      contentIdeas?: string[];
    };
    return {
      summary: parsed.summary ?? "",
      objects: parsed.objects ?? [],
      textDetected: parsed.textDetected ?? [],
      colors: parsed.colors ?? [],
      mood: parsed.mood ?? "",
      contentIdeas: (parsed.contentIdeas ?? []).slice(0, 3),
    };
  } catch {
    return {
      summary: "Image analysis unavailable",
      objects: [],
      textDetected: [],
      colors: [],
      mood: "",
      contentIdeas: [],
    };
  }
}
