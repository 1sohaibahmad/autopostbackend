import { HttpError } from "../lib/httpError";
import { supabase } from "../lib/supabase";
import { getBrandProfileForUserById } from "./brandProfileService";
import { falCompletion } from "./falTextService";
import { env } from "../config/env";
import { canonicalizeSignalsForUser } from "./trendCanonicalService";


type DiscoverySignal = {
  source: string;
  externalId: string;
  title: string;
  description: string;
  url?: string;
  tags: string[];
  platformHints: string[];
  language: string;
  region: string;
  velocityScore: number;
  publishedAt?: string;
  relevanceScore: number;
  reasons: string[];
  imagePromptHint?: string;
  formatType?: "color_theme" | "meme_template" | "caption_pattern" | "challenge" | "news_hook";
  momentumStage?: "rising" | "peaking" | "fading";
  brandSafetyRating?: "safe" | "caution" | "avoid";
  explanation?: string;
  nicheScore?: number;
  brandScore?: number;
  platformBoost?: number;
  sourceBoost?: number;
  freshnessBoost?: number;
};

type TrendExample = {
  source: string;
  title: string;
  url: string;
  excerpt: string;
  publishedAt?: string;
  engagementHint?: string;
};

type DiscoveryResult = {
  generatedAt: string;
  sourcesUsed: string[];
  fallbackCount: number;
  data: DiscoverySignal[];
};

const DISCOVERY_CACHE_TTL_MS = 60 * 1000;
const discoveryCache = new Map<string, { expiresAt: number; value: DiscoveryResult }>();

async function rerankSignalsWithAi(params: {
  rankedSignals: DiscoverySignal[];
  niche?: string;
  platform?: string;
  brandContextSummary?: string;
}): Promise<DiscoverySignal[]> {
  const pool = params.rankedSignals.slice(0, 35);
  if (pool.length < 6) return params.rankedSignals;

  const compactSignals = pool.map((signal, index) => ({
    index,
    source: signal.source,
    title: signal.title.slice(0, 160),
    description: signal.description.slice(0, 240),
    velocityScore: signal.velocityScore,
    baseRelevance: signal.relevanceScore,
  }));

  const prompt = `You are a social trend intelligence assistant.

Task: rerank candidate trend signals for content generation quality.

Platform target: ${params.platform ?? "any"}
Niche: ${params.niche ?? "general"}
Brand context: ${params.brandContextSummary ?? "not provided"}

Candidate signals (JSON):
${JSON.stringify(compactSignals)}

Return ONLY valid JSON in this exact format:
{
  "ranked": [
    { "index": 0, "score": 0-100, "reason": "short reason", "imagePromptHint": "visual direction words" }
  ]
}

Rules:
- Keep all input indexes unique in output.
- Prioritize trend freshness, social conversation potential, and niche fit.
- imagePromptHint should be a concise visual direction phrase (5-20 words).
`;

  try {
    const raw = await falCompletion(prompt, {
      model: "google/gemini-2.5-flash-lite",
      temperature: 0.2,
    });

    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```/, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(cleaned) as { ranked?: Array<{ index: number; score: number; reason?: string; imagePromptHint?: string }> };
    const ranked = parsed.ranked ?? [];
    if (!ranked.length) return params.rankedSignals;

    const scoreByIndex = new Map<number, { score: number; reason?: string; imagePromptHint?: string }>();
    for (const item of ranked) {
      if (typeof item.index !== "number") continue;
      scoreByIndex.set(item.index, {
        score: Math.max(0, Math.min(100, Number(item.score) || 0)),
        reason: item.reason,
        imagePromptHint: item.imagePromptHint,
      });
    }

    const adjustedPool = pool.map((signal, index) => {
      const ai = scoreByIndex.get(index);
      if (!ai) return signal;
      const blended = Math.round(signal.relevanceScore * 0.6 + ai.score * 0.4);
      return {
        ...signal,
        relevanceScore: blended,
        reasons: ai.reason ? [...signal.reasons, `ai_reason:${ai.reason}`] : signal.reasons,
        imagePromptHint: ai.imagePromptHint || signal.imagePromptHint,
      };
    });

    adjustedPool.sort((a, b) => {
      if (b.relevanceScore !== a.relevanceScore) return b.relevanceScore - a.relevanceScore;
      return b.velocityScore - a.velocityScore;
    });

    return [...adjustedPool, ...params.rankedSignals.slice(pool.length)];
  } catch {
    return params.rankedSignals;
  }
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3)
  );
}

function overlapScore(a: Set<string>, b: Set<string>): number {
  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap += 1;
  }
  if (a.size === 0) return 0;
  return Math.round((overlap / a.size) * 100);
}

function decodeHtml(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTag(text: string, tagName: string): string {
  const match = text.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? decodeHtml(match[1]) : "";
}

function parseRssItems(xml: string): Array<{ title: string; link: string; description: string; publishedAt?: string }> {
  const items = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)).map((m) => m[1]);
  return items.map((entry) => ({
    title: extractTag(entry, "title"),
    link: extractTag(entry, "link"),
    description: extractTag(entry, "description"),
    publishedAt: extractTag(entry, "pubDate") || undefined,
  }));
}

function safeUrlKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "").slice(-48) || `k${Date.now()}`;
}

function recencyScore(publishedAt?: string): number {
  if (!publishedAt) return 45;
  const ts = new Date(publishedAt).getTime();
  if (Number.isNaN(ts)) return 45;
  const ageHours = (Date.now() - ts) / (1000 * 60 * 60);
  if (ageHours <= 6) return 95;
  if (ageHours <= 12) return 88;
  if (ageHours <= 24) return 78;
  if (ageHours <= 48) return 66;
  if (ageHours <= 72) return 58;
  return 45;
}

function normalizeDateTime(value?: string): string | undefined {
  if (!value) return undefined;
  const ts = new Date(value).getTime();
  if (Number.isNaN(ts)) return undefined;
  return new Date(ts).toISOString();
}

function platformHintsFromText(text: string): string[] {
  const lower = text.toLowerCase();
  const hints = new Set<string>();
  if (/instagram|reels|stories/.test(lower)) hints.add("instagram");
  if (/linkedin|b2b|professional/.test(lower)) hints.add("linkedin");
  if (/twitter|x\b|thread/.test(lower)) hints.add("x");
  if (/tiktok|short video/.test(lower)) hints.add("tiktok");
  if (/facebook|community/.test(lower)) hints.add("facebook");
  if (/pinterest|pins/.test(lower)) hints.add("pinterest");
  return Array.from(hints);
}

function signalFromRss(params: {
  source: string;
  item: { title: string; link: string; description: string; publishedAt?: string };
  region: string;
  language: string;
}): DiscoverySignal {
  const textBlob = `${params.item.title} ${params.item.description}`;
  const normalizedPublishedAt = normalizeDateTime(params.item.publishedAt);
  return {
    source: params.source,
    externalId: `${params.source}-${safeUrlKey(params.item.link || params.item.title)}`,
    title: params.item.title,
    description: params.item.description || params.item.title,
    url: params.item.link,
    tags: Array.from(tokenize(textBlob)).slice(0, 8),
    platformHints: platformHintsFromText(textBlob),
    language: params.language,
    region: params.region,
    velocityScore: recencyScore(normalizedPublishedAt),
    publishedAt: normalizedPublishedAt,
    relevanceScore: 0,
    reasons: [],
  };
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(6500),
    headers: {
      "user-agent": "autopostbackend/1.0 (trend-engine)",
      accept: "application/json, application/rss+xml, application/xml, text/xml, text/plain",
    },
  });
  if (!response.ok) {
    throw new Error(`Upstream fetch failed (${response.status})`);
  }
  return response.text();
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(6500),
    headers: {
      "user-agent": "autopostbackend/1.0 (trend-engine)",
      accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Upstream fetch failed (${response.status})`);
  }
  return (await response.json()) as T;
}

async function discoverFromHackerNews(region: string, language: string): Promise<DiscoverySignal[]> {
  const xml = await fetchText("https://news.ycombinator.com/rss");
  return parseRssItems(xml)
    .slice(0, 25)
    .map((item) => {
      const signal = signalFromRss({ source: "hackernews", item, region, language });
      signal.platformHints = ["linkedin", "x", ...signal.platformHints].slice(0, 4);
      signal.velocityScore = Math.max(signal.velocityScore, 70);
      return signal;
    });
}

async function discoverFromProductHunt(region: string, language: string): Promise<DiscoverySignal[]> {
  const xml = await fetchText("https://www.producthunt.com/feed");
  return parseRssItems(xml)
    .slice(0, 25)
    .map((item) => {
      const signal = signalFromRss({ source: "producthunt", item, region, language });
      signal.platformHints = ["linkedin", "x", ...signal.platformHints].slice(0, 4);
      return signal;
    });
}

async function discoverFromGoogleNews(niche: string | undefined, region: string, language: string): Promise<DiscoverySignal[]> {
  const query = encodeURIComponent(`${niche || "marketing"} trends`);
  const geos = region.toLowerCase() === "global" ? ["US", "GB", "IN", "CA", "AU", "DE", "BR", "JP"] : [region.toUpperCase()];

  const settled = await Promise.allSettled(
    geos.map((geo) => fetchText(`https://news.google.com/rss/search?q=${query}&hl=en&gl=${geo}&ceid=${geo}:en`))
  );

  return settled
    .filter((result): result is PromiseFulfilledResult<string> => result.status === "fulfilled")
    .flatMap((result) => parseRssItems(result.value).slice(0, 20))
    .map((item) => {
      const signal = signalFromRss({ source: "google_news", item, region, language });
      signal.platformHints = ["linkedin", "x", "instagram", ...signal.platformHints].slice(0, 5);
      return signal;
    });
}

async function discoverFromPlatformPulse(
  platform: string | undefined,
  niche: string | undefined,
  region: string,
  language: string
): Promise<DiscoverySignal[]> {
  if (!platform) return [];

  const geos = region.toLowerCase() === "global" ? ["US", "GB", "IN", "CA"] : [region.toUpperCase()];
  const query = encodeURIComponent(`${platform} trend ${niche || ""}`.trim());

  const settled = await Promise.allSettled(
    geos.map((geo) => fetchText(`https://news.google.com/rss/search?q=${query}&hl=en&gl=${geo}&ceid=${geo}:en`))
  );

  return settled
    .filter((result): result is PromiseFulfilledResult<string> => result.status === "fulfilled")
    .flatMap((result) => parseRssItems(result.value).slice(0, 20))
    .map((item) => {
      const signal = signalFromRss({ source: "platform_pulse", item, region, language });
      signal.platformHints = [platform, ...signal.platformHints].filter(Boolean).slice(0, 6) as string[];
      signal.velocityScore = Math.max(signal.velocityScore, 68);
      return signal;
    });
}

async function discoverFromGoogleTrends(region: string, language: string): Promise<DiscoverySignal[]> {
  const geos = region.toLowerCase() === "global" ? ["US", "GB", "IN", "CA", "AU", "DE", "BR", "JP"] : [region.toUpperCase()];
  const settled = await Promise.allSettled(geos.map((geo) => fetchText(`https://trends.google.com/trending/rss?geo=${geo}`)));

  return settled
    .filter((result): result is PromiseFulfilledResult<string> => result.status === "fulfilled")
    .flatMap((result) => parseRssItems(result.value).slice(0, 20))
    .map((item) => {
      const signal = signalFromRss({ source: "google_trends", item, region, language });
      signal.platformHints = ["instagram", "x", "linkedin", "tiktok", "facebook", "pinterest"];
      signal.velocityScore = Math.max(signal.velocityScore, 72);
      return signal;
    });
}

async function discoverFromDevTo(region: string, language: string): Promise<DiscoverySignal[]> {
  const json = await fetchJson<Array<{ id: number; title: string; description: string; url: string; published_at: string; tag_list: string[] }>>(
    "https://dev.to/api/articles?top=20"
  );
  return (json ?? []).slice(0, 20).map((entry) => ({
    source: "devto",
    externalId: `devto-${entry.id}`,
    title: entry.title,
    description: entry.description || entry.title,
    url: entry.url,
    tags: (entry.tag_list ?? []).slice(0, 10),
    platformHints: ["linkedin", "x"],
    language,
    region,
    velocityScore: recencyScore(normalizeDateTime(entry.published_at)),
    publishedAt: normalizeDateTime(entry.published_at),
    relevanceScore: 0,
    reasons: [],
  }));
}

async function discoverFromMastodon(region: string, language: string): Promise<DiscoverySignal[]> {
  const json = await fetchJson<Array<{ name: string; url?: string; history?: Array<{ day: string; uses: string; accounts: string }> }>>(
    "https://mastodon.social/api/v1/trends/tags?limit=20"
  );

  return (json ?? []).slice(0, 20).map((item) => {
    const latestHistory = item.history?.[0];
    const uses = Number(latestHistory?.uses ?? 0);
    const accounts = Number(latestHistory?.accounts ?? 0);
    const velocity = Math.max(35, Math.min(100, Math.round(Math.log10(uses + 1) * 35 + Math.log10(accounts + 1) * 20 + 35)));
    const title = item.name.startsWith("#") ? item.name : `#${item.name}`;

    return {
      source: "mastodon",
      externalId: `mastodon-${safeUrlKey(item.name)}`,
      title,
      description: `Trending social tag ${title} with active discussion.`,
      url: item.url,
      tags: Array.from(tokenize(`${title} social trend`)).slice(0, 8),
      platformHints: ["x", "linkedin", "instagram"],
      language,
      region,
      velocityScore: velocity,
      publishedAt: new Date().toISOString(),
      relevanceScore: 0,
      reasons: ["source:mastodon_trends"],
    };
  });
}

function sourceTasksForPlatform(params: { niche?: string; region: string; language: string; platform?: string }) {
  const socialFirst = [
    () => discoverFromReddit(params.niche, params.region, params.language, params.platform),
    () => discoverFromMastodon(params.region, params.language),
    () => discoverFromGoogleTrends(params.region, params.language),
  ];

  if (params.platform === "instagram" || params.platform === "facebook" || params.platform === "tiktok" || params.platform === "pinterest") {
    return [
      ...socialFirst,
      () => discoverFromPlatformPulse(params.platform, params.niche, params.region, params.language),
      () => discoverFromGoogleNews(params.niche, params.region, params.language),
    ];
  }

  if (params.platform === "linkedin" || params.platform === "x") {
    return [
      ...socialFirst,
      () => discoverFromPlatformPulse(params.platform, params.niche, params.region, params.language),
      () => discoverFromProductHunt(params.region, params.language),
      () => discoverFromDevTo(params.region, params.language),
      () => discoverFromHackerNews(params.region, params.language),
      () => discoverFromGoogleNews(params.niche, params.region, params.language),
    ];
  }

  return [
    ...socialFirst,
    () => discoverFromPlatformPulse(params.platform, params.niche, params.region, params.language),
    () => discoverFromProductHunt(params.region, params.language),
    () => discoverFromHackerNews(params.region, params.language),
    () => discoverFromGoogleNews(params.niche, params.region, params.language),
    () => discoverFromDevTo(params.region, params.language),
  ];
}

function redditSubredditsForNiche(niche?: string, platform?: string): string[] {
  if (platform === "instagram") return ["Instagram", "socialmedia", "marketing", "smallbusiness"];
  if (platform === "linkedin") return ["linkedin", "marketing", "sales", "Entrepreneur"];
  if (platform === "x") return ["Twitter", "socialmedia", "technology", "marketing"];
  if (platform === "tiktok") return ["TikTok", "socialmedia", "marketing", "smallbusiness"];
  if (platform === "facebook") return ["FacebookAds", "facebook", "marketing", "smallbusiness"];
  if (platform === "pinterest") return ["Pinterest", "Etsy", "marketing", "smallbusiness"];

  const n = (niche ?? "").toLowerCase();
  if (/(saas|startup|b2b|product)/.test(n)) return ["startups", "Entrepreneur", "SaaS", "marketing"];
  if (/(ai|ml|artificial intelligence|automation)/.test(n)) return ["artificial", "MachineLearning", "singularity", "OpenAI"];
  if (/(ecommerce|shop|d2c|retail)/.test(n)) return ["ecommerce", "shopify", "marketing", "smallbusiness"];
  if (/(crypto|web3|blockchain)/.test(n)) return ["CryptoCurrency", "ethtrader", "defi", "bitcoin"];
  return ["marketing", "socialmedia", "technology", "entrepreneur"];
}

async function discoverFromReddit(niche: string | undefined, region: string, language: string, platform?: string): Promise<DiscoverySignal[]> {
  const subreddits = redditSubredditsForNiche(niche, platform);
  const settled = await Promise.allSettled(
    subreddits.map((subreddit) =>
      fetchJson<{
        data?: { children?: Array<{ data?: { id: string; title: string; selftext?: string; permalink?: string; created_utc?: number; score?: number; num_comments?: number } }> };
      }>(`https://www.reddit.com/r/${subreddit}/hot.json?limit=12`)
    )
  );

  const signals: DiscoverySignal[] = [];

  for (let i = 0; i < settled.length; i += 1) {
    const result = settled[i];
    if (result.status !== "fulfilled") continue;
    const subreddit = subreddits[i];
    const children = result.value?.data?.children ?? [];

    for (const child of children) {
      const post = child.data;
      if (!post?.title) continue;
      const score = Number(post.score) || 0;
      const comments = Number(post.num_comments) || 0;
      const velocity = Math.max(35, Math.min(100, Math.round(Math.log10(score + 1) * 28 + Math.log10(comments + 1) * 20 + 30)));
      const publishedAt = post.created_utc ? new Date(post.created_utc * 1000).toISOString() : undefined;
      const textBlob = `${post.title} ${post.selftext ?? ""} ${subreddit}`;

      signals.push({
        source: "reddit",
        externalId: `reddit-${post.id}`,
        title: post.title,
        description: (post.selftext || post.title).slice(0, 5000),
        url: post.permalink ? `https://www.reddit.com${post.permalink}` : undefined,
        tags: Array.from(tokenize(textBlob)).slice(0, 10),
        platformHints: platformHintsFromText(textBlob),
        language,
        region,
        velocityScore: velocity,
        publishedAt,
        relevanceScore: 0,
        reasons: [`reddit_score:${score}`, `reddit_comments:${comments}`, `subreddit:${subreddit}`],
      });
    }
  }

  return signals;
}

function computeRelevance(signal: DiscoverySignal, contextTokens: Set<string>, nicheTokens: Set<string>, platform?: string): DiscoverySignal {
  const signalTokens = tokenize(`${signal.title} ${signal.description} ${signal.tags.join(" ")}`);
  const nicheScore = nicheTokens.size ? overlapScore(nicheTokens, signalTokens) : 40;
  const brandScore = contextTokens.size ? overlapScore(contextTokens, signalTokens) : 50;
  const platformBoost = platform && signal.platformHints.includes(platform) ? 12 : 0;
  const sourceBoost =
    signal.source === "platform_pulse"
      ? 10
      : signal.source === "reddit"
      ? 6
      : signal.source === "hackernews" || signal.source === "producthunt" || signal.source === "devto"
      ? 5
      : signal.source === "mastodon"
      ? 1
      : signal.source === "google_news"
      ? -3
      : 0;
  const intentPenalty =
    (nicheTokens.size > 0 && nicheScore === 0 ? 22 : 0) +
    (contextTokens.size > 0 && brandScore === 0 ? 18 : 0);
  const freshnessBoost = signal.publishedAt
    ? Math.max(0, 10 - Math.floor((Date.now() - new Date(signal.publishedAt).getTime()) / (1000 * 60 * 60 * 3)))
    : 0;
  const relevance = Math.round(
    Math.max(
      0,
      Math.min(
        100,
        nicheScore * 0.28 + brandScore * 0.42 + signal.velocityScore * 0.24 + platformBoost + sourceBoost + freshnessBoost - intentPenalty
      )
    )
  );
  return {
    ...signal,
    relevanceScore: relevance,
    nicheScore,
    brandScore,
    platformBoost,
    sourceBoost,
    freshnessBoost,
    reasons: [
      `niche_match:${nicheScore}`,
      `brand_match:${brandScore}`,
      `velocity:${signal.velocityScore}`,
      `platform_boost:${platformBoost}`,
      `source_boost:${sourceBoost}`,
      `freshness_boost:${freshnessBoost}`,
      `intent_penalty:${intentPenalty}`,
    ],
  };
}

function classifyTrendSignal(signal: DiscoverySignal, niche?: string, platform?: string): DiscoverySignal {
  const text = `${signal.title} ${signal.description} ${signal.tags.join(" ")}`.toLowerCase();
  const hoursOld = signal.publishedAt ? (Date.now() - new Date(signal.publishedAt).getTime()) / (1000 * 60 * 60) : 72;

  let momentumStage: DiscoverySignal["momentumStage"] = "fading";
  if (signal.velocityScore >= 82 || hoursOld <= 12) momentumStage = "peaking";
  else if (signal.velocityScore >= 62 || hoursOld <= 36) momentumStage = "rising";

  let brandSafetyRating: DiscoverySignal["brandSafetyRating"] = "safe";
  if (/(war|shooting|disaster|tragedy|violent|adult|nsfw)/.test(text)) brandSafetyRating = "avoid";
  else if (/(politic|election|religion|crime|lawsuit|controvers)/.test(text)) brandSafetyRating = "caution";

  let formatType: DiscoverySignal["formatType"] = "news_hook";
  if (/(meme|template|parody)/.test(text)) formatType = "meme_template";
  else if (/(challenge|duet|stitch|remix)/.test(text)) formatType = "challenge";
  else if (/(palette|color|theme|aesthetic|look)/.test(text)) formatType = "color_theme";
  else if (/(caption|hook|headline|thread)/.test(text)) formatType = "caption_pattern";

  const explanation = `Why it fits: ${signal.source} trend with ${momentumStage} momentum, ${signal.relevanceScore}/100 relevance${platform ? ` for ${platform}` : ""}${niche ? ` in ${niche}` : ""}.`;

  return {
    ...signal,
    momentumStage,
    brandSafetyRating,
    formatType,
    explanation,
  };
}

export async function discoverTrendSignals(params: {
  userId: string;
  limit: number;
  niche?: string;
  platform?: string;
  language: string;
  region: string;
  brandProfileId?: number;
}): Promise<DiscoveryResult> {
  const cacheKey = JSON.stringify({
    userId: params.userId,
    limit: params.limit,
    niche: params.niche ?? "",
    platform: params.platform ?? "",
    language: params.language,
    region: params.region,
    brandProfileId: params.brandProfileId ?? 0,
  });

  const cached = discoveryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  let contextTokens = new Set<string>();
  let brandContextSummary = "";
  if (params.brandProfileId) {
    const brand = await getBrandProfileForUserById(params.userId, params.brandProfileId);
    brandContextSummary = [
      brand.brand_name,
      brand.industry,
      brand.target_audience ?? "",
      brand.brand_voice ?? "",
      ...(brand.products ?? []).map((p) => `${p.name} ${p.description ?? ""}`),
    ]
      .join(" ")
      .slice(0, 900);
    contextTokens = tokenize(
      brandContextSummary
    );
  }

  const nicheTokens = tokenize(params.niche ?? "");

  const settled = await Promise.allSettled(sourceTasksForPlatform(params).map((task) => task()));

  const merged = settled
    .filter((s): s is PromiseFulfilledResult<DiscoverySignal[]> => s.status === "fulfilled")
    .flatMap((s) => s.value)
    .filter((signal) => {
      if (!signal.publishedAt) return true;
      const ageMs = Date.now() - new Date(signal.publishedAt).getTime();
      return ageMs <= 24 * 60 * 60 * 1000;
    })
    .map((signal) => computeRelevance(signal, contextTokens, nicheTokens, params.platform));

  const deduped = new Map<string, DiscoverySignal>();
  for (const signal of merged) {
    const key = signal.url || `${signal.source}:${signal.externalId}`;
    const existing = deduped.get(key);
    if (!existing || signal.relevanceScore > existing.relevanceScore) {
      deduped.set(key, signal);
    }
  }

  const rankedByRules = Array.from(deduped.values()).sort((a, b) => {
    if (b.relevanceScore !== a.relevanceScore) return b.relevanceScore - a.relevanceScore;
    return b.velocityScore - a.velocityScore;
  });

  const ranked = await rerankSignalsWithAi({
    rankedSignals: rankedByRules,
    niche: params.niche,
    platform: params.platform,
    brandContextSummary,
  });

  const classified = ranked.map((signal) => classifyTrendSignal(signal, params.niche, params.platform));

  const platformFiltered = params.platform
    ? classified.filter((signal) => signal.platformHints.includes(params.platform!) || ["reddit", "mastodon"].includes(signal.source))
    : classified;

  const hasIntentSignals = Boolean(params.niche?.trim()) || contextTokens.size > 0;
  const relevanceFloor = hasIntentSignals ? 55 : 45;
  const qualityFiltered = platformFiltered.filter((signal) => {
    if (signal.relevanceScore < relevanceFloor) return false;

    if (params.platform === "linkedin") {
      const hasBusinessFit = (signal.nicheScore ?? 0) > 0 || (signal.brandScore ?? 0) > 0;
      const trustedLinkedinSources = ["hackernews", "producthunt", "devto", "reddit", "google_news", "platform_pulse", "google_trends"];
      if (!hasBusinessFit && !trustedLinkedinSources.includes(signal.source)) {
        return false;
      }

      if (!hasBusinessFit && ["mastodon"].includes(signal.source)) {
        return false;
      }
    }

    if (hasIntentSignals && (signal.nicheScore ?? 0) === 0 && (signal.brandScore ?? 0) === 0 && signal.source !== "platform_pulse") {
      return false;
    }

    return true;
  });

  const buckets = new Map<string, DiscoverySignal[]>();
  const pool = qualityFiltered.length ? qualityFiltered : platformFiltered;
  for (const signal of pool) {
    const list = buckets.get(signal.source) ?? [];
    list.push(signal);
    buckets.set(signal.source, list);
  }

  const diversified: DiscoverySignal[] = [];
  const sources = Array.from(buckets.keys());
  let cursor = 0;
  while (diversified.length < params.limit && sources.length) {
    const source = sources[cursor % sources.length];
    const list = buckets.get(source) ?? [];
    const next = list.shift();
    if (next) diversified.push(next);
    if (!list.length) {
      buckets.delete(source);
      sources.splice(cursor % sources.length, 1);
      if (!sources.length) break;
      continue;
    }
    cursor += 1;
  }

  const result = {
    generatedAt: new Date().toISOString(),
    sourcesUsed: Array.from(new Set((diversified.length ? diversified : pool.slice(0, params.limit)).map((item) => item.source))),
    fallbackCount: settled.filter((s) => s.status === "rejected").length,
    data: diversified.length ? diversified : pool.slice(0, params.limit),
  };

  discoveryCache.set(cacheKey, {
    expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS,
    value: result,
  });

  try {
    await canonicalizeSignalsForUser(
      params.userId,
      result.data.map((signal) => ({
        source: signal.source,
        externalId: signal.externalId,
        title: signal.title,
        description: signal.description,
        url: signal.url,
        tags: signal.tags,
        platformHints: signal.platformHints,
        language: signal.language,
        region: signal.region,
        velocityScore: signal.velocityScore,
        publishedAt: signal.publishedAt,
      }))
    );
  } catch {
    // canonicalization is best effort in this phase
  }

  return result;
}

export async function fetchTrendExamples(params: {
  trendTitle: string;
  platform?: string;
  limit: number;
}): Promise<TrendExample[]> {
  const q = encodeURIComponent(params.trendTitle.trim());
  const reddit = await fetchJson<{
    data?: {
      children?: Array<{
        data?: {
          title: string;
          selftext?: string;
          permalink?: string;
          created_utc?: number;
          score?: number;
          num_comments?: number;
        };
      }>;
    };
  }>(`https://www.reddit.com/search.json?q=${q}&sort=top&t=day&limit=${Math.max(5, params.limit * 2)}`);

  const examples: TrendExample[] = (reddit.data?.children ?? [])
    .map((item) => item.data)
    .filter((item): item is NonNullable<typeof item> => Boolean(item?.title && item?.permalink))
    .map((item) => ({
      source: "reddit",
      title: item.title,
      url: `https://www.reddit.com${item.permalink}`,
      excerpt: (item.selftext || item.title).slice(0, 240),
      publishedAt: item.created_utc ? new Date(item.created_utc * 1000).toISOString() : undefined,
      engagementHint: `score:${Number(item.score) || 0} comments:${Number(item.num_comments) || 0}`,
    }));

  if (params.platform) {
    return examples
      .filter((item) => platformHintsFromText(`${item.title} ${item.excerpt}`).includes(params.platform!))
      .slice(0, params.limit);
  }

  return examples.slice(0, params.limit);
}

export async function ingestTrendSignals(
  userId: string,
  payload: {
    source: string;
    signals: Array<{
      externalId: string;
      title: string;
      description: string;
      url?: string;
      tags: string[];
      platformHints: string[];
      language: string;
      region: string;
      velocityScore: number;
      publishedAt?: string;
    }>;
  }
) {
  let inserted = 0;
  let updated = 0;

  for (const signal of payload.signals) {
    const row = {
      user_id: userId,
      source: payload.source,
      external_id: signal.externalId,
      title: signal.title,
      description: signal.description,
      url: signal.url ?? null,
      tags: signal.tags,
      platform_hints: signal.platformHints,
      language: signal.language,
      region: signal.region,
      velocity_score: signal.velocityScore,
      published_at: signal.publishedAt ?? null,
    };

    const { data: existing, error: findError } = await supabase
      .from("trend_signals")
      .select("id")
      .eq("user_id", userId)
      .eq("source", payload.source)
      .eq("external_id", signal.externalId)
      .maybeSingle();

    if (findError) {
      throw new HttpError(500, findError.message, "DB_ERROR");
    }

    if (existing) {
      const { error } = await supabase.from("trend_signals").update(row).eq("id", existing.id).eq("user_id", userId);
      if (error) {
        throw new HttpError(500, error.message, "DB_ERROR");
      }
      updated += 1;
    } else {
      const { error } = await supabase.from("trend_signals").insert(row);
      if (error) {
        throw new HttpError(500, error.message, "DB_ERROR");
      }
      inserted += 1;
    }
  }

  try {
    await canonicalizeSignalsForUser(
      userId,
      payload.signals.map((signal) => ({
        source: payload.source,
        externalId: signal.externalId,
        title: signal.title,
        description: signal.description,
        url: signal.url,
        tags: signal.tags,
        platformHints: signal.platformHints,
        language: signal.language,
        region: signal.region,
        velocityScore: signal.velocityScore,
        publishedAt: signal.publishedAt,
      }))
    );
  } catch {
    // canonicalization is best effort in this phase
  }

  return { inserted, updated, total: payload.signals.length };
}

export async function listTrendSignals(userId: string, options: { source?: string; platform?: string; minVelocity?: number; q?: string; limit: number }) {
  let query = supabase
    .from("trend_signals")
    .select("*")
    .eq("user_id", userId)
    .order("velocity_score", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(options.limit);

  if (options.source) {
    query = query.eq("source", options.source);
  }

  if (options.platform) {
    query = query.filter("platform_hints", "cs", JSON.stringify([options.platform]));
  }

  if (typeof options.minVelocity === "number") {
    query = query.gte("velocity_score", options.minVelocity);
  }

  if (options.q?.trim()) {
    query = query.or(`title.ilike.%${options.q.trim()}%,description.ilike.%${options.q.trim()}%`);
  }

  const { data, error } = await query;
  if (error) {
    throw new HttpError(500, error.message, "DB_ERROR");
  }
  return data ?? [];
}

export async function recomputeTrendMatches(params: {
  userId: string;
  brandProfileId: number;
  platform: string;
  limitSignals: number;
}) {
  const brand = await getBrandProfileForUserById(params.userId, params.brandProfileId);
  const brandContext = [
    brand.brand_name,
    brand.industry,
    brand.target_audience ?? "",
    brand.brand_voice ?? "",
    ...(brand.products ?? []).map((p) => `${p.name} ${p.description ?? ""}`),
  ].join(" ");
  const brandTokens = tokenize(brandContext);

  const { data: signals, error } = await supabase
    .from("trend_signals")
    .select("*")
    .eq("user_id", params.userId)
    .order("velocity_score", { ascending: false })
    .limit(params.limitSignals);

  if (error) {
    throw new HttpError(500, error.message, "DB_ERROR");
  }

  const computed = (signals ?? []).map((signal: any) => {
    const signalTokens = tokenize(`${signal.title} ${signal.description} ${(signal.tags ?? []).join(" ")}`);
    const semantic = overlapScore(brandTokens, signalTokens);
    const platformBoost = (signal.platform_hints ?? []).includes(params.platform) ? 12 : 0;
    const velocity = Math.min(100, Math.max(0, Number(signal.velocity_score) || 0));
    const score = Math.round(Math.min(100, semantic * 0.65 + velocity * 0.25 + platformBoost));

    return {
      signal,
      score,
      reasons: [
        `Semantic overlap: ${semantic}`,
        `Velocity score: ${velocity}`,
        `Platform hint boost: ${platformBoost}`,
      ],
    };
  });

  for (const match of computed) {
    const payload = {
      user_id: params.userId,
      brand_profile_id: params.brandProfileId,
      signal_id: match.signal.id,
      platform: params.platform,
      relevance_score: match.score,
      reasons: match.reasons,
      status: "candidate",
    };

    const { data: existing } = await supabase
      .from("trend_relevance_matches")
      .select("id")
      .eq("user_id", params.userId)
      .eq("brand_profile_id", params.brandProfileId)
      .eq("signal_id", match.signal.id)
      .eq("platform", params.platform)
      .maybeSingle();

    if (existing) {
      await supabase.from("trend_relevance_matches").update(payload).eq("id", existing.id);
    } else {
      await supabase.from("trend_relevance_matches").insert(payload);
    }
  }

  const sorted = computed.sort((a, b) => b.score - a.score);
  return {
    evaluated: computed.length,
    topScore: sorted[0]?.score ?? 0,
    matches: sorted,
  };
}

export async function listTrendMatches(params: {
  userId: string;
  brandProfileId: number;
  platform: string;
  minScore: number;
  limit: number;
}) {
  const { data, error } = await supabase
    .from("trend_relevance_matches")
    .select("*, trend_signals(*)")
    .eq("user_id", params.userId)
    .eq("brand_profile_id", params.brandProfileId)
    .eq("platform", params.platform)
    .gte("relevance_score", params.minScore)
    .order("relevance_score", { ascending: false })
    .limit(params.limit);

  if (error) {
    throw new HttpError(500, error.message, "DB_ERROR");
  }
  return data ?? [];
}
