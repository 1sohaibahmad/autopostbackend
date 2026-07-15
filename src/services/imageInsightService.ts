import OpenAI from "openai";
import { env } from "../config/env";

const openai = new OpenAI({ apiKey: env.openAiApiKey });

export async function extractImageContentContext(params: { imageUrl: string; focus?: string }) {
  const focus = params.focus?.trim() || "Extract social-content-relevant details for post generation.";

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: `${focus}\nReturn only JSON with keys: summary, objects, textDetected, colors, mood, contentIdeas (max 3).` },
          { type: "image_url", image_url: { url: params.imageUrl } },
        ],
      },
    ],
  });

  const raw = (completion.choices[0]?.message?.content ?? "").trim();
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```/, "").replace(/```$/, "").trim();

  try {
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
      summary: cleaned,
      objects: [],
      textDetected: [],
      colors: [],
      mood: "",
      contentIdeas: [],
    };
  }
}
