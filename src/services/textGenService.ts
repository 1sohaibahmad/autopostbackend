import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 2000,
  shouldRetry: (err: unknown) => boolean = () => false
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries && shouldRetry(err)) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        console.log(`Retryable error, retrying in ${delay}ms, attempt ${attempt + 1}/${maxRetries}`);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
  throw lastError;
}

interface BrandProfile {
  brand_name: string;
  industry: string;
  target_audience: string;
  brand_voice: string;
}

interface GeneratedContent {
  caption: string;
  headlineText: string;
  hashtags: string[];
  imageDirection: string;
}

export async function generateCaption(
  brandProfile: BrandProfile,
  platform: string,
  postType: string,
  topic: string,
  tone: string
): Promise<GeneratedContent> {
  const prompt = `You are a social media content strategist.

Brand Name: ${brandProfile.brand_name}
Industry: ${brandProfile.industry}
Target Audience: ${brandProfile.target_audience}
Brand Voice: ${brandProfile.brand_voice}

Platform: ${platform}
Post Type: ${postType}
Topic: ${topic}
Tone: ${tone}

Create a social media post for the above details. Respond with ONLY a JSON object in this exact format, no extra text:
{
  "caption": "The full caption text for the post",
  "headlineText": "A short punchy headline, under 10 words, suitable as bold overlay text on an image",
  "hashtags": ["hashtag1", "hashtag2", "hashtag3"],
  "imageDirection": "A detailed description of what the image for this post should look like"
}`;

  const result = await retryWithBackoff(
    () =>
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
      }),
    3,
    2000,
    (err) => {
      if (err instanceof Error) {
        const msg = err.message || "";
        if (msg.includes("429") || msg.includes("Too Many Requests") || msg.includes("rate_limit")) return true;
        if (msg.includes("503") || msg.includes("overloaded")) return true;
      }
      return false;
    }
  );

  const response = result.choices[0]?.message?.content ?? "";

  let cleaned = response.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  }
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();

  try {
    const parsed = JSON.parse(cleaned) as GeneratedContent;
    return parsed;
  } catch {
    throw new Error("Failed to parse OpenAI response as JSON");
  }
}
