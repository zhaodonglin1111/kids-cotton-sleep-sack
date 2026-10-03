/**
 * 浏览器渲染自检：
 * - 用系统 Edge/Chrome 打开 index.html
 * - 截图（桌面 + 移动）方便肉眼核对
 * - 单独导出成品预览图、裁片图、拼接图
 * - 检查页面无横向溢出、无 SVG 尺寸为 0 的图
 *
 * 运行：node tests/render.mjs
 * 依赖全局 Playwright（Codex 运行时自带），或用 PLAYWRIGHT_DIR 指定 node_modules。
 */
import { mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const shots = join(root, "preview");
mkdirSync(shots, { recursive: true });

const runtimeNodeModules =
  process.env.PLAYWRIGHT_DIR ||
  "C:/Users/润泽园/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules";
const { chromium } = await import(pathToFileURL(join(runtimeNodeModules, "playwright", "index.mjs")).href);

const candidates = [
  process.env.BROWSER_PATH,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].filter(Boolean);

const fileUrl = pathToFileURL(join(root, "index.html")).href;
let browser = null;
let lastError = null;

for (const executablePath of candidates) {
  try {
    browser = await chromium.launch({ executablePath, headless: true });
    break;
  } catch (err) {
    lastError = err;
  }
}

if (!browser) {
  console.error("无法启动浏览器，请设置 BROWSER_PATH。");
  console.error(lastError && lastError.message);
  process.exit(1);
}

const problems = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
await page.goto(fileUrl, { waitUntil: "load" });
await page.evaluate(() => document.fonts && document.fonts.ready);
await page.waitForTimeout(400);

// 横向溢出
const overflow = await page.evaluate(() => {
  const de = document.documentElement;
  return { scrollW: de.scrollWidth, clientW: de.clientWidth };
});
if (overflow.scrollW > overflow.clientW + 1) {
  problems.push(`桌面端横向溢出：scrollWidth ${overflow.scrollW} > clientWidth ${overflow.clientW}`);
}

// 每张 SVG 都要有实际尺寸
const svgSizes = await page.evaluate(() =>
  Array.from(document.querySelectorAll("svg")).map((s) => {
    const r = s.getBoundingClientRect();
    return { id: s.id || "(no id)", w: Math.round(r.width), h: Math.round(r.height) };
  })
);
for (const s of svgSizes) {
  if (s.w < 80 || s.h < 80) problems.push(`SVG ${s.id} 尺寸异常：${s.w}×${s.h}`);
}

// 全页截图（桌面）
await page.screenshot({ path: join(shots, "full-desktop.png"), fullPage: true });

// 单图导出
async function shoot(selector, name, padding = 8) {
  const el = await page.$(selector);
  if (!el) {
    problems.push(`找不到 ${selector}`);
    return;
  }
  await el.screenshot({ path: join(shots, name) });
}

await page.addStyleTag({
  content: ".topbar{display:none!important}aside,.toc-drawer{display:none!important}",
});
await shoot(".hero-art", "01-finished-preview.png");
await shoot("#piecesArt", "02-pattern-pieces.png");
await shoot("#layoutArt", "03-fabric-layout.png");
await shoot("#quiltStack", "04-quilt-layers.png");
await shoot("#assemblyArt", "05-assembly-steps.png");

// 移动端
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
const mobile = await page.evaluate(() => {
  const de = document.documentElement;
  return { scrollW: de.scrollWidth, clientW: de.clientWidth };
});
if (mobile.scrollW > mobile.clientW + 1) {
  problems.push(`移动端横向溢出：scrollWidth ${mobile.scrollW} > clientWidth ${mobile.clientW}`);
}
await page.screenshot({ path: join(shots, "full-mobile.png"), fullPage: true });

await browser.close();

for (const s of svgSizes) console.log(`  svg  ${s.id}  ${s.w}×${s.h}`);
for (const p of problems) console.error(`  FAIL ${p}`);
console.log(
  problems.length
    ? `\nFAIL  渲染自检 ${problems.length} 项问题`
    : `\nPASS  渲染自检通过，截图已写入 preview/`
);
process.exit(problems.length ? 1 : 0);
