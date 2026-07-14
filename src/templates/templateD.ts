export interface PostTemplateData {
  headline: string;
  subtext?: string;
  brandColors: string[];
  brandLogo?: string | null;
  brandName: string;
  backgroundImageUrl: string;
  features?: string[];
  ctaText?: string;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function darken(hex: string, amount: number): string {
  const h = hex.replace("#", "");
  const r = Math.max(0, parseInt(h.substring(0, 2), 16) - amount);
  const g = Math.max(0, parseInt(h.substring(2, 4), 16) - amount);
  const b = Math.max(0, parseInt(h.substring(4, 6), 16) - amount);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function contrastTextColor(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? "#1a1a2e" : "#ffffff";
}

export function buildPostHtml(data: PostTemplateData): string {
  const primary = data.brandColors[0] ?? "#3b6fe8";
  const darkBg = darken(primary, 50);
  const textColor = contrastTextColor(primary);

  const headlineSafe = escapeHtml(data.headline);
  const subtextSafe = escapeHtml(data.subtext ?? "");
  const brandNameSafe = escapeHtml(data.brandName);
  const bgImageEscaped = escapeHtml(data.backgroundImageUrl);
  const ctaSafe = escapeHtml(data.ctaText || data.brandName);

  const features = data.features ?? [];
  const featurePills = features
    .map(
      (f) =>
        `<span class="feature-pill">${escapeHtml(f)}</span>`
    )
    .join("");

  const logoBlock = data.brandLogo
    ? `<img src="${escapeHtml(data.brandLogo)}" alt="" class="badge-logo" />`
    : `<div class="badge-logo-placeholder"></div>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;600;700;800;900&display=swap" rel="stylesheet" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    width: 1080px;
    height: 1080px;
    font-family: 'Montserrat', Arial, sans-serif;
    overflow: hidden;
    background: ${primary};
  }

  .canvas {
    width: 1080px;
    height: 1080px;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0 60px;
    position: relative;
  }

  /* ── Top badge ── */
  .badge {
    margin-top: 60px;
    display: inline-flex;
    align-items: center;
    gap: 12px;
    background: rgba(255,255,255,0.95);
    border-radius: 999px;
    padding: 10px 24px 10px 14px;
  }

  .badge-logo {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    object-fit: contain;
  }

  .badge-logo-placeholder {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: ${darken(primary, 20)};
  }

  .badge-name {
    font-size: 20px;
    font-weight: 700;
    color: #1a1a2e;
    letter-spacing: -0.2px;
  }

  /* ── Headline ── */
  .headline {
    margin-top: 40px;
    font-size: 78px;
    font-weight: 900;
    line-height: 1.05;
    color: #ffffff;
    text-align: center;
    max-width: 85%;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }

  /* ── Subtext ── */
  .subtext {
    margin-top: 24px;
    font-size: 28px;
    font-weight: 600;
    line-height: 1.4;
    color: rgba(255,255,255,0.9);
    text-align: center;
    max-width: 80%;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }

  /* ── Feature pills ── */
  .features-row {
    margin-top: 40px;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 12px;
  }

  .feature-pill {
    border: 1.5px solid rgba(255,255,255,0.5);
    border-radius: 999px;
    padding: 8px 20px;
    font-size: 18px;
    font-weight: 600;
    color: #ffffff;
    white-space: nowrap;
  }

  /* ── Photo panel ── */
  .photo-panel {
    margin-top: 40px;
    width: 960px;
    height: 460px;
    position: relative;
    overflow: hidden;
    border-radius: 32px;
    flex-shrink: 0;
  }

  .photo-panel img {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
    display: block;
  }

  /* ── CTA pill ── */
  .cta-pill {
    margin-top: -24px;
    position: relative;
    z-index: 2;
    background: ${darkBg};
    border-radius: 999px;
    padding: 12px 32px;
    display: inline-flex;
    align-items: center;
  }

  .cta-text {
    font-size: 18px;
    font-weight: 700;
    color: #ffffff;
    letter-spacing: 0.5px;
  }
</style>
</head>
<body>
  <div class="canvas">
    <div class="badge">
      ${logoBlock}
      <span class="badge-name">${brandNameSafe}</span>
    </div>

    <div class="headline">${headlineSafe}</div>

    ${subtextSafe ? `<div class="subtext">${subtextSafe}</div>` : ""}

    ${featurePills ? `<div class="features-row">${featurePills}</div>` : ""}

    <div class="photo-panel">
      <img src="${bgImageEscaped}" alt="" />
    </div>

    <div class="cta-pill">
      <span class="cta-text">${ctaSafe}</span>
    </div>
  </div>
</body>
</html>`;
}
