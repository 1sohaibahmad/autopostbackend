import Replicate from "replicate";
import sharp from "sharp";
import { retryWithBackoff } from "./textGenService";
import { env } from "../config/env";

const replicate = env.replicateApiToken ? new Replicate({ auth: env.replicateApiToken }) : null;

// ── Replicate (active) ──────────────────────────────────
export interface ImageGenerationOptions {
  width?: number;
  height?: number;
}

async function generateImageReplicate(imageDirection: string, options?: ImageGenerationOptions): Promise<string> {
  if (!replicate) {
    throw new Error("REPLICATE_API_TOKEN is not configured");
  }

  const output = await retryWithBackoff(
    () =>
      replicate.run("stability-ai/sdxl:7762fd07cf82c948538e41f63f77d685e02b063e37e496e96eefd46c929f9bdc", {
        input: {
          prompt: imageDirection,
          negative_prompt:
            "cartoon, anime, illustration, lowres, blurry, deformed face, malformed hands, extra fingers, watermark, logo, text, celebrity likeness, trademarked character",
          num_inference_steps: 40,
          guidance_scale: 7.5,
          width: options?.width ?? 1080,
          height: options?.height ?? 1350,
        },
      }),
    3,
    2000,
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

  return finalUrl;
}

function generateImagePollinations(imageDirection: string, options?: ImageGenerationOptions): string {
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(imageDirection)}?width=${options?.width ?? 1080}&height=${options?.height ?? 1350}&nologo=true&enhance=true`;
}

export interface GeneratedImage {
  url: string;
  provider: "replicate" | "pollinations";
  model: string;
}

export async function generateImage(imageDirection: string, options?: ImageGenerationOptions): Promise<GeneratedImage> {
  try {
    const url = await generateImageReplicate(imageDirection, options);
    return {
      url,
      provider: "replicate",
      model: "stability-ai/sdxl",
    };
  } catch {
    return {
      url: generateImagePollinations(imageDirection, options),
      provider: "pollinations",
      model: "pollinations/image",
    };
  }
}

// ── fal.ai fallback ─────────────────────────────────────
// import { fal } from "@fal-ai/client";
// fal.config({ credentials: process.env.FAL_KEY });
//
// async function generateImageFal(imageDirection: string): Promise<string> {
//   const result = await retryWithBackoff(
//     () =>
//       fal.subscribe("fal-ai/flux/dev", {
//         input: { prompt: imageDirection, image_size: "square_hd", num_inference_steps: 28 },
//       }),
//     3, 2000,
//     (err) => err instanceof Error && (err.message.includes("429") || err.message.includes("503"))
//   );
//   const url = (result as any).data?.images?.[0]?.url;
//   if (!url) throw new Error("fal.ai returned no image URL");
//   return url;
// }

// ── Pollinations fallback (free, lower quality) ─────────
// function generateImagePollinations(imageDirection: string): string {
//   return `https://image.pollinations.ai/prompt/${encodeURIComponent(imageDirection)}?width=1024&height=1024&nologo=true&enhance=true`;
// }

export async function addTextOverlay(
  imageUrl: string,
  overlayText: string,
  options?: {
    subtitle?: string;
    cta?: string;
    brandName?: string;
  }
): Promise<Buffer> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch base image: ${response.status}`);
  }
  const arrayBuf = await response.arrayBuffer();
  const inputBuffer = Buffer.from(arrayBuf);

  const image = sharp(inputBuffer);
  const metadata = await image.metadata();
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
      <text font-family="Arial, Helvetica, sans-serif" font-size="${badgeSize}" font-weight="700" fill="white" x="${cardX + Math.round(cardW * 0.11)}" y="${cardY + Math.round(cardH * 0.17)}">NEW CAMPAIGN</text>
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
