import OpenAI from "openai";
import { env } from "../config/env";

const openai = new OpenAI({ apiKey: env.openAiApiKey });

export interface FinalSafetyJudgeIssue {
  category: "ip" | "policy" | "brand" | "platform";
  severity: "low" | "medium" | "high";
  message: string;
}

export interface FinalSafetyJudgeResult {
  passed: boolean;
  score: number;
  issues: FinalSafetyJudgeIssue[];
  rationale: string;
  rawModel?: string;
}

export async function runFinalSafetyJudge(input: {
  platform: string;
  caption: string;
  hashtags: string[];
  imageDirection: string;
  trendSummary?: string;
  bannedWords?: string[];
  topicsToAvoid?: string[];
}): Promise<FinalSafetyJudgeResult> {
  const normalizeCategory = (value: string | undefined): FinalSafetyJudgeIssue["category"] => {
    if (value === "ip" || value === "policy" || value === "brand" || value === "platform") return value;
    return "policy";
  };
  const normalizeSeverity = (value: string | undefined): FinalSafetyJudgeIssue["severity"] => {
    if (value === "low" || value === "medium" || value === "high") return value;
    return "medium";
  };

  const prompt = `You are a strict final safety and IP reviewer for social content generation.

Evaluate this post payload and return ONLY valid JSON.

Platform: ${input.platform}
Caption: ${input.caption}
Hashtags: ${input.hashtags.join(" ")}
Image direction: ${input.imageDirection}
Trend summary: ${input.trendSummary ?? "none"}
Banned words: ${(input.bannedWords ?? []).join(", ") || "none"}
Topics to avoid: ${(input.topicsToAvoid ?? []).join(", ") || "none"}

Decision rules:
- Fail if there is likely copyright/trademark/personality-right risk.
- Fail if there are unsafe or unverifiable claims.
- Fail if banned words or avoided topics are present.
- High severity means hard fail.

JSON schema:
{
  "passed": true|false,
  "score": 0-100,
  "rationale": "short reason",
  "issues": [
    {"category":"ip|policy|brand|platform","severity":"low|medium|high","message":"text"}
  ]
}`;

  try {
    const result = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
    });

    const raw = (result.choices[0]?.message?.content ?? "").trim();
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```/, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(cleaned) as {
      passed?: boolean;
      score?: number;
      rationale?: string;
      issues?: Array<{ category?: string; severity?: string; message?: string }>;
    };

    const issues: FinalSafetyJudgeIssue[] = (parsed.issues ?? [])
      .map((issue) => ({
        category: normalizeCategory(issue.category),
        severity: normalizeSeverity(issue.severity),
        message: String(issue.message ?? "Unspecified issue").slice(0, 240),
      }))
      .slice(0, 8);

    const score = Math.max(0, Math.min(100, Number(parsed.score) || 0));
    const hasHigh = issues.some((issue) => issue.severity === "high");

    return {
      passed: Boolean(parsed.passed) && !hasHigh,
      score,
      issues,
      rationale: String(parsed.rationale ?? "Final judge completed."),
      rawModel: "gpt-4o-mini",
    };
  } catch {
    return {
      passed: false,
      score: 0,
      issues: [
        {
          category: "policy",
          severity: "high",
          message: "Final safety judge unavailable.",
        },
      ],
      rationale: "Judge call failed.",
      rawModel: "gpt-4o-mini",
    };
  }
}
