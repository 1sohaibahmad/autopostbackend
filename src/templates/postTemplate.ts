export interface PostTemplateData {
  headline: string;
  subtext?: string;
  brandColors: string[];
  brandLogo?: string | null;
  brandName: string;
  backgroundImageUrl: string;
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
  const accent = data.brandColors[1] ?? darken(primary, 30);
  const footerBg = darken(primary, 45);
  const textColor = contrastTextColor(primary);
  const headlineSafe = escapeHtml(data.headline);
  const subtextSafe = data.subtext ? escapeHtml(data.subtext) : "";
  const brandNameSafe = escapeHtml(data.brandName);
  const bgImageEscaped = escapeHtml(data.backgroundImageUrl);

  const logoBlock = data.brandLogo
    ? `<div class="logo-box">
         <img src="${escapeHtml(data.brandLogo)}" alt="Logo" class="logo-img" />
       </div>`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700;800&display=swap" rel="stylesheet" />
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
    flex-direction: row;
    position: relative;
  }

  /* ── Left panel (colored text area) ── */
  .panel-left {
    width: 700px;
    height: 1080px;
    background: ${primary};
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 64px 56px 40px 56px;
    position: relative;
    z-index: 2;
    flex-shrink: 0;
  }

  .headline {
    font-size: 52px;
    font-weight: 800;
    line-height: 1.15;
    color: ${textColor};
    margin-bottom: 20px;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }

  .accent-bar {
    width: 64px;
    height: 5px;
    background: ${accent};
    border-radius: 3px;
    margin-bottom: 24px;
  }

  .subtext {
    font-size: 20px;
    font-weight: 600;
    line-height: 1.5;
    color: ${textColor};
    opacity: 0.82;
    word-wrap: break-word;
    overflow-wrap: break-word;
    max-width: 90%;
  }

  .logo-box {
    position: absolute;
    bottom: 56px;
    left: 56px;
    background: rgba(255,255,255,0.92);
    border-radius: 14px;
    padding: 10px 16px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .logo-img {
    max-height: 44px;
    max-width: 140px;
    object-fit: contain;
  }

  /* ── Right panel (photo) ── */
  .panel-right {
    width: 380px;
    height: 1080px;
    position: relative;
    overflow: hidden;
    flex-shrink: 0;
  }

  .bg-image {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
    display: block;
  }

  /* ── Footer bar ── */
  .footer {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 56px;
    background: ${footerBg};
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 3;
  }

  .footer-text {
    font-size: 15px;
    font-weight: 700;
    color: ${textColor};
    letter-spacing: 2.5px;
    text-transform: uppercase;
    opacity: 0.9;
  }
</style>
</head>
<body>
  <div class="canvas">
    <div class="panel-left">
      <div class="headline">${headlineSafe}</div>
      <div class="accent-bar"></div>
      ${subtextSafe ? `<div class="subtext">${subtextSafe}</div>` : ""}
      ${logoBlock}
    </div>
    <div class="panel-right">
      <img src="${bgImageEscaped}" alt="" class="bg-image" />
    </div>
    <div class="footer">
      <span class="footer-text">${brandNameSafe}</span>
    </div>
  </div>
</body>
</html>`;
}
