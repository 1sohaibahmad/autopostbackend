import OpenAI from "openai";
import { env } from "../config/env";

const openai = new OpenAI({ apiKey: env.openAiApiKey });

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
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
  throw lastError;
}

export interface BrandProfile {
  brand_name: string;
  industry: string;
  target_audience: string;
  brand_voice: string;
  products?: Array<{ name: string; description: string }>;
  topics_to_avoid?: string[];
  banned_words?: string[];
}

export interface GeneratedContent {
  caption: string;
  headlineText: string;
  hashtags: string[];
  imageDirection: string;
  cta?: string;
  qualityScore: number;
  qualityReasons: string[];
  strategy: {
    hookType: string;
    coreAngle: string;
    proofPoint: string;
    ctaApproach: string;
  };
  alternatives: Array<{
    caption: string;
    headlineText: string;
    hashtags: string[];
    cta?: string;
  }>;
}

interface TrendBriefResult {
  summary: string;
  adaptationAngle: string;
  doList: string[];
  dontList: string[];
  riskNotes: string[];
}

async function createJsonCompletion(prompt: string): Promise<string> {
  const result = await retryWithBackoff(
    () =>
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.45,
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

  let cleaned = (result.choices[0]?.message?.content ?? "").trim();
  if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
  if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
  return cleaned.trim();
}

const genericPhrases = [
  "unlock your potential",
  "game changer",
  "best solution",
  "next level",
  "revolutionary",
  "don't miss out",
  "boost your",
];

function scoreCandidate(candidate: {
  caption: string;
  hashtags: string[];
  cta?: string;
}): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 100;
  const captionLower = candidate.caption.toLowerCase();

  for (const phrase of genericPhrases) {
    if (captionLower.includes(phrase)) {
      score -= 12;
      reasons.push(`Generic phrase detected: ${phrase}`);
    }
  }

  if (candidate.caption.length < 70) {
    score -= 10;
    reasons.push("Caption too short for strong context.");
  }

  if (candidate.caption.length > 700) {
    score -= 8;
    reasons.push("Caption may be too long for most platforms.");
  }

  if (candidate.hashtags.length < 3) {
    score -= 8;
    reasons.push("Too few hashtags.");
  }

  if (!candidate.cta || candidate.cta.trim().length < 6) {
    score -= 8;
    reasons.push("Weak CTA signal.");
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    reasons,
  };
}

export async function generateCaption(
  brandProfile: BrandProfile,
  platform: string,
  postType: string,
  topic: string,
  tone: string,
  trendContext?: {
    summary?: string;
    adaptationAngle?: string;
    objective?: string;
  },
  generationContext?: {
    objective?: "awareness" | "engagement" | "leads" | "sales";
    audienceSegment?: string;
    proofPoints?: string[];
    refinementInstruction?: string;
  }
): Promise<GeneratedContent> {
  const productHints =
    (brandProfile.products ?? []).slice(0, 5).map((p) => `${p.name}: ${p.description}`).join("\n") || "None provided";
  const avoidTopics = (brandProfile.topics_to_avoid ?? []).join(", ") || "None provided";
  const bannedWords = (brandProfile.banned_words ?? []).join(", ") || "None provided";
  const proofPoints = (generationContext?.proofPoints ?? []).slice(0, 8).join("; ") || "None provided";

  const prompt = `You are an elite social growth strategist.

Brand Name: ${brandProfile.brand_name}
Industry: ${brandProfile.industry}
Target Audience: ${brandProfile.target_audience}
Brand Voice: ${brandProfile.brand_voice}
Products: ${productHints}
Topics to Avoid: ${avoidTopics}
Banned Words: ${bannedWords}

Platform: ${platform}
Post Type: ${postType}
Topic: ${topic}
Tone: ${tone}
Trend Summary: ${trendContext?.summary ?? "None"}
Trend Adaptation Angle: ${trendContext?.adaptationAngle ?? "None"}
Objective: ${trendContext?.objective ?? "engagement"}
Primary Objective: ${generationContext?.objective ?? trendContext?.objective ?? "engagement"}
Audience Segment: ${generationContext?.audienceSegment ?? "Default brand audience"}
Proof Points: ${proofPoints}
Refinement Instruction: ${generationContext?.refinementInstruction ?? "None"}

Create high-quality, specific and non-generic content.
Rules:
- Use concrete nouns and practical context.
- Avoid cliches and vague motivational language.
- Keep it platform-native and brand-safe.
- Respect banned words and topics to avoid.
- Incorporate the proof points naturally when relevant.
- If post type is review_testimonial, use ONLY user-provided claims/proof points and never fabricate customer quotes or ratings.
- If post type is comparison, avoid defamatory or unverifiable competitor claims.
- If post type is holiday_occasion, tie the message to a specific occasion naturally.
- For trend-based content, riff on trend ideas without copying copyrighted assets, logos, celebrity faces, album art, or lyrics.
- imageDirection must clearly reflect trend cues when available (color palette, composition style, mood), while staying original and IP-safe.
- If refinement instruction is present, prioritize it over prior style assumptions while remaining brand-safe.

Respond with ONLY JSON in this exact format:
{
  "strategy": {
    "hookType": "pattern interrupt/story/data/challenge",
    "coreAngle": "1 sentence",
    "proofPoint": "1 sentence",
    "ctaApproach": "1 sentence"
  },
  "candidates": [
    {
      "caption": "full caption",
      "headlineText": "under 10 words",
      "hashtags": ["hashtag1", "hashtag2", "hashtag3"],
      "imageDirection": "detailed visual direction",
      "cta": "clear CTA"
    }
  ]
}
Return 4 candidates with different hook styles.`;

  const cleaned = await createJsonCompletion(prompt);

  try {
    const parsed = JSON.parse(cleaned) as {
      strategy?: {
        hookType?: string;
        coreAngle?: string;
        proofPoint?: string;
        ctaApproach?: string;
      };
      candidates?: Array<{
        caption?: string;
        headlineText?: string;
        hashtags?: string[];
        imageDirection?: string;
        cta?: string;
      }>;
    };

    const candidates = (parsed.candidates ?? []).filter((item) => item.caption && item.headlineText && item.imageDirection);
    if (!candidates.length) {
      throw new Error("Model returned no usable candidates");
    }

    const scored = candidates.map((candidate) => {
      const normalized = {
        caption: candidate.caption!.trim(),
        headlineText: candidate.headlineText!.trim(),
        hashtags: (candidate.hashtags ?? []).map((tag) => String(tag).trim()).filter(Boolean),
        imageDirection: candidate.imageDirection!.trim(),
        cta: candidate.cta?.trim(),
      };
      const quality = scoreCandidate({
        caption: normalized.caption,
        hashtags: normalized.hashtags,
        cta: normalized.cta,
      });
      return { ...normalized, quality };
    });

    scored.sort((a, b) => b.quality.score - a.quality.score);
    const best = scored[0];

    return {
      caption: best.caption,
      headlineText: best.headlineText,
      hashtags: best.hashtags,
      imageDirection: best.imageDirection,
      cta: best.cta,
      qualityScore: best.quality.score,
      qualityReasons: best.quality.reasons,
      strategy: {
        hookType: parsed.strategy?.hookType ?? "story",
        coreAngle: parsed.strategy?.coreAngle ?? "Brand-led value angle",
        proofPoint: parsed.strategy?.proofPoint ?? "Demonstrate practical value",
        ctaApproach: parsed.strategy?.ctaApproach ?? "Invite clear next action",
      },
      alternatives: scored.slice(1, 4).map((alt) => ({
        caption: alt.caption,
        headlineText: alt.headlineText,
        hashtags: alt.hashtags,
        cta: alt.cta,
      })),
    };
  } catch {
    throw new Error("Failed to parse OpenAI response as JSON");
  }
}

export async function generateTrendBrief(params: {
  brandName: string;
  industry: string;
  targetAudience: string;
  brandVoice: string;
  platform: string;
  trendTitle: string;
  trendDescription: string;
  objective: string;
}): Promise<TrendBriefResult> {
  const prompt = `You are TrendAdaptationService.
Brand: ${params.brandName}
Industry: ${params.industry}
Audience: ${params.targetAudience}
Brand Voice: ${params.brandVoice}
Platform: ${params.platform}
Trend Title: ${params.trendTitle}
Trend Description: ${params.trendDescription}
Objective: ${params.objective}

Create a trend adaptation brief. Keep it specific and practical. Return JSON only with this format:
{
  "summary": "One-paragraph brief",
  "adaptationAngle": "How this brand should adapt the trend uniquely",
  "doList": ["3-5 concrete recommendations"],
  "dontList": ["3-5 risks or things to avoid"],
  "riskNotes": ["IP/safety/platform notes"]
}`;

  const cleaned = await createJsonCompletion(prompt);
  try {
    return JSON.parse(cleaned) as TrendBriefResult;
  } catch {
    throw new Error("Failed to parse trend brief response as JSON");
  }
}
