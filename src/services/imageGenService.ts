import { fal } from "@fal-ai/client";
import sharp from "sharp";
import { retryWithBackoff } from "./textGenService";

fal.config({ credentials: process.env.FAL_KEY });

export async function generateImage(imageDirection: string): Promise<string> {
  const result = await retryWithBackoff(
    () =>
      fal.subscribe("fal-ai/flux/dev", {
        input: {
          prompt: imageDirection,
          image_size: "square_hd",
          num_inference_steps: 28,
        },
      }),
    3,
    2000,
    (err) => {
      if (err instanceof Error) {
        const msg = err.message || "";
        if (msg.includes("429") || msg.includes("Too Many Requests")) return true;
        if (msg.includes("503") || msg.includes("overloaded")) return true;
      }
      return false;
    }
  );

  const imageUrl = (result as any).data?.images?.[0]?.url;
  if (!imageUrl) {
    throw new Error("fal.ai returned no image URL");
  }
  return imageUrl;
}

// ── Pollinations fallback (kept for reference) ──────────
// export function generateImagePollinations(imageDirection: string): string {
//   return `https://image.pollinations.ai/prompt/${encodeURIComponent(imageDirection)}?width=1024&height=1024&nologo=true&enhance=true`;
// }

export async function addTextOverlay(
  imageUrl: string,
  overlayText: string
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

  const fontSize = Math.round(w / 20);
  const bandHeight = fontSize * 3.5;
  const bandY = Math.round(h * 0.62);

  const lines = wrapText(overlayText, Math.round(w * 0.8), fontSize);
  const textSvg = lines
    .map(
      (line, i) =>
        `<tspan x="${w / 2}" dy="${i === 0 ? 0 : fontSize * 1.3}">${escapeXml(line)}</tspan>`
    )
    .join("");

  const svgOverlay = `
    <svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="black" stop-opacity="0"/>
          <stop offset="100%" stop-color="black" stop-opacity="0.75"/>
        </linearGradient>
      </defs>
      <rect x="0" y="${bandY}" width="${w}" height="${bandHeight}" fill="url(#fade)"/>
      <text
        font-family="Arial, Helvetica, sans-serif"
        font-size="${fontSize}"
        font-weight="bold"
        fill="white"
        text-anchor="middle"
        dominant-baseline="middle"
        x="${w / 2}"
        y="${bandY + bandHeight / 2}"
      >${textSvg}</text>
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
