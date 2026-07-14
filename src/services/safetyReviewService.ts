export interface SafetyReviewInput {
  caption: string;
  hashtags: string[];
  platform: string;
  bannedWords?: string[];
  topicsToAvoid?: string[];
}

export interface SafetyIssue {
  category: "generic" | "policy" | "platform" | "brand";
  severity: "low" | "medium" | "high";
  message: string;
}

export interface SafetyReviewResult {
  passed: boolean;
  issues: SafetyIssue[];
  score: number;
}

const genericPhrases = ["unlock your potential", "game changer", "best solution ever", "revolutionary"];
const riskyClaimPatterns = [/\bguaranteed\b/i, /\b100%\b/i, /\bno risk\b/i, /\binstant results\b/i];

export function reviewSafety(input: SafetyReviewInput): SafetyReviewResult {
  const issues: SafetyIssue[] = [];
  const lowered = input.caption.toLowerCase();

  for (const phrase of genericPhrases) {
    if (lowered.includes(phrase)) {
      issues.push({
        category: "generic",
        severity: "low",
        message: `Avoid generic phrase: \"${phrase}\"`,
      });
    }
  }

  for (const pattern of riskyClaimPatterns) {
    if (pattern.test(input.caption)) {
      issues.push({
        category: "policy",
        severity: "medium",
        message: "Potential unverifiable or risky claim detected.",
      });
      break;
    }
  }

  for (const word of input.bannedWords ?? []) {
    if (word && lowered.includes(word.toLowerCase())) {
      issues.push({
        category: "brand",
        severity: "high",
        message: `Contains banned word: ${word}`,
      });
    }
  }

  for (const topic of input.topicsToAvoid ?? []) {
    if (topic && lowered.includes(topic.toLowerCase())) {
      issues.push({
        category: "brand",
        severity: "medium",
        message: `Potentially conflicts with topic to avoid: ${topic}`,
      });
    }
  }

  if (input.platform === "linkedin" && input.hashtags.length > 5) {
    issues.push({
      category: "platform",
      severity: "low",
      message: "LinkedIn post should use 3-5 hashtags.",
    });
  }

  if (input.platform === "x" && input.caption.length > 280) {
    issues.push({
      category: "platform",
      severity: "high",
      message: "X caption exceeds 280 characters.",
    });
  }

  const weightedPenalty = issues.reduce((sum, issue) => {
    if (issue.severity === "high") return sum + 30;
    if (issue.severity === "medium") return sum + 15;
    return sum + 6;
  }, 0);

  const score = Math.max(0, 100 - weightedPenalty);
  const hasHighIssue = issues.some((issue) => issue.severity === "high");

  return {
    passed: !hasHighIssue && score >= 60,
    issues,
    score,
  };
}
