import Replicate from "replicate";
import { fal } from "@fal-ai/client";
import sharp from "sharp";
import { retryWithBackoff } from "./textGenService";
import { env } from "../config/env";

const replicate = env.replicateApiToken ? new Replicate({ auth: env.replicateApiToken }) : null;

if (env.falApiKey) {
  fal.config({ credentials: env.falApiKey });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function validateGeneratedImageUrl(url: string, options?: ImageGenerationOptions): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(7000) });
  if (!response.ok) {
    throw new Error(`Generated image fetch failed (${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const meta = await sharp(buffer).metadata();
  const minWidth = Math.round((options?.width ?? 1080) * 0.72);
  const minHeight = Math.round((options?.height ?? 1350) * 0.72);
  if (!meta.width || !meta.height || meta.width < minWidth || meta.height < minHeight) {
    throw new Error(`Generated image too small (${meta.width ?? 0}x${meta.height ?? 0})`);
  }
}

// ── fal.ai (primary) ─────────────────────────────────────
function falSizeForDimensions(width?: number, height?: number): string {
  if (!width || !height) return "portrait_4_3";
  const ratio = width / height;
  if (ratio > 1.3) return "landscape_16_9";
  if (ratio > 1.05) return "landscape_4_3";
  if (ratio < 0.6) return "portrait_16_9";
  if (ratio < 0.8) return "portrait_4_3";
  return width >= 1024 ? "square_hd" : "square";
}

async function generateImageFal(
  imageDirection: string,
  options?: ImageGenerationOptions
): Promise<{ url: string; model: string }> {
  if (!env.falApiKey) {
    throw new Error("FAL_KEY is not configured");
  }

  const models = ["fal-ai/flux/dev", "fal-ai/flux/schnell"] as const;
  const errors: string[] = [];

  for (const model of models) {
    try {
      const result = await retryWithBackoff(
        () =>
          withTimeout(
            fal
              .subscribe(model, {
                input: {
                  prompt: imageDirection,
                  image_size: falSizeForDimensions(options?.width, options?.height) as any,
                  num_inference_steps: 28,
                  guidance_scale: 3.5,
                  enable_safety_checker: true,
                },
              })
              .then((res: any) => res.data),
            25000,
            `fal.ai image generation (${model})`
          ),
        1,
        1200,
        (err: any) => {
          if (err instanceof Error) {
            const msg = err.message || "";
            if (msg.includes("429") || msg.includes("Too Many Requests")) return true;
            if (msg.includes("503") || msg.includes("overloaded")) return true;
          }
          return false;
        }
      );

      const url = result?.images?.[0]?.url;
      if (!url || typeof url !== "string") {
        throw new Error("fal.ai returned no image URL: " + JSON.stringify(result));
      }

      await validateGeneratedImageUrl(url, options);
      return { url, model };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      errors.push(`${model}: ${message}`);
    }
  }

  throw new Error(`FAL failed on all models. ${errors.join(" | ")}`);
}

// ── Replicate (fallback) ──────────────────────────────────
export interface ImageGenerationOptions {
  width?: number;
  height?: number;
}

async function generateImageReplicate(imageDirection: string, options?: ImageGenerationOptions): Promise<string> {
  if (!replicate) {
    throw new Error("REPLICATE_API_TOKEN is not configured");
  }

  const requestedWidth = options?.width ?? 1080;
  const requestedHeight = options?.height ?? 1350;
  const width = Math.max(512, Math.round(requestedWidth / 8) * 8);
  const height = Math.max(512, Math.round(requestedHeight / 8) * 8);

  const output = await retryWithBackoff(
    () =>
      withTimeout(
        replicate.run("stability-ai/sdxl:7762fd07cf82c948538e41f63f77d685e02b063e37e496e96eefd46c929f9bdc", {
          input: {
            prompt: imageDirection,
            negative_prompt:
              "cartoon, anime, illustration, lowres, blurry, deformed face, malformed hands, extra fingers, watermark, logo, text, celebrity likeness, trademarked character",
            num_inference_steps: 34,
            guidance_scale: 7,
            width,
            height,
          },
        }),
        18000,
        "replicate image generation"
      ),
    1,
    900,
    (err) => {
      if (err instanceof Error) {
        const msg = err.message || "";
        if (msg.includes("429") || msg.includes("Too Many Requests")) return true;
        if (msg.includes("503") || msg.includes("overloaded")) return true;
        if (msg.includes("Director") || msg.includes("unexpected error handling prediction")) return true;
      }
      return false;
    }
  );

  let finalUrl: string | undefined;

  if (Array.isArray(output) && output.length > 0) {
    const first = output[0];
    if (typeof first === "string") {
      finalUrl = first;
    } else if (typeof first === "object" && first !== null) {
      if (typeof (first as any).url === "function") {
        finalUrl = String(await (first as any).url());
      } else if ("url" in first && (first as any).url != null) {
        finalUrl = String((first as any).url);
      }
    }
  } else if (typeof output === "string") {
    finalUrl = output;
  }

  if (finalUrl == null) {
    throw new Error("Unexpected Replicate output format: " + JSON.stringify(output));
  }

  if (typeof finalUrl !== "string") {
    throw new Error("Extracted image URL is not a string: " + typeof finalUrl);
  }

  await validateGeneratedImageUrl(finalUrl, options);

  return finalUrl;
}

function generateImagePollinations(imageDirection: string, options?: ImageGenerationOptions): string {
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(imageDirection)}?width=${options?.width ?? 1080}&height=${options?.height ?? 1350}&nologo=true&enhance=true`;
}

export interface GeneratedImage {
  url: string;
  provider: "fal" | "replicate" | "pollinations";
  model: string;
}

export async function generateImage(imageDirection: string, options?: ImageGenerationOptions): Promise<GeneratedImage> {
  // 1. Try fal.ai first
  let falErr: unknown = null;
  let replicateErr: unknown = null;
  try {
    const falImage = await generateImageFal(imageDirection, options);
    return {
      url: falImage.url,
      provider: "fal",
      model: falImage.model,
    };
  } catch (falError) {
    falErr = falError;
    // 2. Fall back to Replicate if available
    if (replicate) {
      try {
        const url = await generateImageReplicate(imageDirection, options);
        return {
          url,
          provider: "replicate",
          model: "stability-ai/sdxl",
        };
      } catch (replicateError) {
        replicateErr = replicateError;
      }
    }

    // 3. Last resort: Pollinations (only if allowed)
    if (!env.allowLowQualityImageFallback) {
      const falMsg = falErr instanceof Error ? falErr.message : "unknown FAL error";
      const replicateMsg = replicate
        ? replicateErr instanceof Error
          ? replicateErr.message
          : "unknown Replicate error"
        : "REPLICATE_API_TOKEN is not configured";
      throw new Error(`Primary image providers unavailable. fal=${falMsg}; replicate=${replicateMsg}`);
    }
    const fallbackUrl = generateImagePollinations(imageDirection, options);
    await validateGeneratedImageUrl(fallbackUrl, options);
    return {
      url: fallbackUrl,
      provider: "pollinations",
      model: "pollinations/image",
    };
  }
}

export async function addTextOverlay(
  imageUrl: string,
  overlayText: string,
  options?: {
    subtitle?: string;
    cta?: string;
    brandName?: string;
    badge?: string;
  }
): Promise<Buffer> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch base image: ${response.status}`);
  }
  const arrayBuf = await response.arrayBuffer();
  const inputBuffer = Buffer.from(arrayBuf);

  let image = sharp(inputBuffer);
  let metadata = await image.metadata();
  if ((metadata.width ?? 0) < 900 || (metadata.height ?? 0) < 900) {
    image = image.resize(1080, 1350, { fit: "cover", kernel: sharp.kernel.lanczos3 }).sharpen();
    metadata = await image.metadata();
  }
  const w = metadata.width ?? 1024;
  const h = metadata.height ?? 1024;

  const titleSize = Math.max(34, Math.round(w / 19));
  const subtitleSize = Math.max(18, Math.round(w / 38));
  const badgeSize = Math.max(14, Math.round(w / 58));

  const cardX = Math.round(w * 0.06);
  const cardY = Math.round(h * 0.08);
  const cardW = Math.round(w * 0.88);
  const cardH = Math.round(h * 0.42);

  const titleLines = wrapText(overlayText.toUpperCase(), Math.round(cardW * 0.86), titleSize).slice(0, 3);
  const subtitle = options?.subtitle?.trim() ? options.subtitle.trim() : "Designed to stop the scroll and drive action.";
  const subtitleLines = wrapText(subtitle, Math.round(cardW * 0.84), subtitleSize).slice(0, 2);
  const cta = (options?.cta?.trim() || "Learn More").slice(0, 28).toUpperCase();
  const brand = (options?.brandName?.trim() || "").slice(0, 38).toUpperCase();
  const badge = (options?.badge?.trim() || "NEW POST").slice(0, 24).toUpperCase();

  const titleSvg = titleLines
    .map(
      (line, i) =>
        `<tspan x="${cardX + cardW * 0.08}" dy="${i === 0 ? 0 : titleSize * 1.12}">${escapeXml(line)}</tspan>`
    )
    .join("");

  const subtitleSvg = subtitleLines
    .map(
      (line, i) =>
        `<tspan x="${cardX + cardW * 0.08}" dy="${i === 0 ? 0 : subtitleSize * 1.28}">${escapeXml(line)}</tspan>`
    )
    .join("");

  const titleBlockY = cardY + Math.round(cardH * 0.26);
  const subtitleBlockY = titleBlockY + Math.round(titleSize * (Math.max(1, titleLines.length) + 0.9));
  const ctaW = Math.round(Math.max(180, Math.min(cardW * 0.34, 320)));
  const ctaH = Math.round(Math.max(50, h * 0.055));
  const ctaX = cardX + Math.round(cardW * 0.08);
  const ctaY = cardY + cardH - ctaH - Math.round(cardH * 0.12);

  const svgOverlay = `
    <svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="card" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#0c1f33" stop-opacity="0.92"/>
          <stop offset="100%" stop-color="#142e4a" stop-opacity="0.88"/>
        </linearGradient>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="8" stdDeviation="10" flood-opacity="0.28"/>
        </filter>
      </defs>
      <rect x="0" y="0" width="${w}" height="${h}" fill="black" opacity="0.14"/>
      <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="24" fill="url(#card)" filter="url(#shadow)"/>
      <rect x="${cardX + Math.round(cardW * 0.08)}" y="${cardY + Math.round(cardH * 0.11)}" width="${Math.round(cardW * 0.33)}" height="${Math.round(cardH * 0.08)}" rx="8" fill="#23b26d" opacity="0.95"/>
      <text font-family="Arial, Helvetica, sans-serif" font-size="${badgeSize}" font-weight="700" fill="white" x="${cardX + Math.round(cardW * 0.11)}" y="${cardY + Math.round(cardH * 0.17)}">${escapeXml(badge)}</text>
      <text
        font-family="Arial, Helvetica, sans-serif"
        font-size="${titleSize}"
        font-weight="800"
        fill="white"
        text-anchor="start"
        dominant-baseline="middle"
        x="${cardX + Math.round(cardW * 0.08)}"
        y="${titleBlockY}"
      >${titleSvg}</text>
      <text
        font-family="Arial, Helvetica, sans-serif"
        font-size="${subtitleSize}"
        font-weight="500"
        fill="white"
        opacity="0.92"
        text-anchor="start"
        dominant-baseline="middle"
        x="${cardX + Math.round(cardW * 0.08)}"
        y="${subtitleBlockY}"
      >${subtitleSvg}</text>
      <rect x="${ctaX}" y="${ctaY}" width="${ctaW}" height="${ctaH}" rx="12" fill="#ffffff"/>
      <text font-family="Arial, Helvetica, sans-serif" font-size="${Math.round(subtitleSize * 0.94)}" font-weight="800" fill="#10263d" text-anchor="middle" dominant-baseline="middle" x="${ctaX + ctaW / 2}" y="${ctaY + ctaH / 2}">${escapeXml(cta)}</text>
      ${brand ? `<text font-family="Arial, Helvetica, sans-serif" font-size="${Math.round(subtitleSize * 0.86)}" font-weight="700" fill="white" opacity="0.82" x="${ctaX + ctaW + 18}" y="${ctaY + ctaH / 2}">${escapeXml(brand)}</text>` : ""}
    </svg>
  `;

  const overlayBuffer = Buffer.from(svgOverlay);

  const result = await image
    .composite([{ input: overlayBuffer, top: 0, left: 0 }])
    .png()
    .toBuffer();

  return result;
}

function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
  const avgCharWidth = fontSize * 0.55;
  const maxChars = Math.floor(maxWidth / avgCharWidth);

  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (current.length + word.length + 1 > maxChars && current.length > 0) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [text];
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
