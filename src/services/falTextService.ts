import { fal } from "@fal-ai/client";
import { env } from "../config/env";

if (env.falApiKey) {
  fal.config({ credentials: env.falApiKey });
}

export interface FalCompletionOptions {
  model?: string;
  temperature?: number;
  maxRetries?: number;
  timeoutMs?: number;
}

function extractText(data: any): string {
  if (typeof data?.output === "string") return data.output;
  if (typeof data?.choices?.[0]?.message?.content === "string") return data.choices[0].message.content;
  if (typeof data?.response === "string") return data.response;
  if (typeof data === "string") return data;
  return "";
}

export async function falCompletion(
  prompt: string,
  options?: FalCompletionOptions
): Promise<string> {
  if (!env.falApiKey) {
    throw new Error("FAL_KEY is not configured");
  }

  const model = options?.model ?? "google/gemini-2.5-flash-lite";
  const timeoutMs = options?.timeoutMs ?? 15000;
  const maxRetries = options?.maxRetries ?? 1;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await Promise.race([
        fal.subscribe("fal-ai/any-llm", {
          input: {
            prompt,
            model,
          },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`fal-ai/any-llm timed out after ${timeoutMs}ms`)), timeoutMs)
        ),
      ]);

      const text = extractText((result as any).data ?? result);
      if (!text) {
        throw new Error("fal-ai/any-llm returned empty response");
      }
      return text;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const msg = err instanceof Error ? err.message : "";
        const retryable = msg.includes("429") || msg.includes("503") || msg.includes("overloaded") || msg.includes("rate_limit");
        if (retryable) {
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
          continue;
        }
      }
      throw err;
    }
  }
  throw lastError;
}

export async function falChatCompletion(
  messages: Array<{ role: string; content: any }>,
  options?: FalCompletionOptions & { responseFormat?: { type: string } }
): Promise<string> {
  if (!env.falApiKey) {
    throw new Error("FAL_KEY is not configured");
  }

  const model = options?.model ?? "google/gemini-2.5-flash-lite";
  const timeoutMs = options?.timeoutMs ?? 15000;

  const prompt = messages
    .filter((m) => m.role === "user")
    .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
    .join("\n\n");

  return falCompletion(prompt, { ...options, model, timeoutMs });
}
