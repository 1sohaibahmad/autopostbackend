import puppeteer from "puppeteer";
import { buildPostHtml, type PostTemplateData } from "../templates/postTemplate";

export async function renderPostImage(data: PostTemplateData): Promise<Buffer> {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1080, deviceScaleFactor: 1 });

    const html = buildPostHtml(data);
    await page.setContent(html, { waitUntil: "load", timeout: 30000 });
    await page.waitForNetworkIdle({ idleTime: 500 });

    const screenshot = await page.screenshot({ type: "png" });

    return Buffer.from(screenshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Template render failed: ${message}`);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
