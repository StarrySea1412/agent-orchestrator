// 本地无头验收（VOL.10）：四枚小样逐状态、错误收集、移动端溢出
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire("D:/project/machine-skill/node_modules/");
const { chromium } = require("playwright");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shots = join(root, "shots");
await mkdir(shots, { recursive: true });
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".woff2": "font/woff2", ".webp": "image/webp", ".png": "image/png", ".mp4": "video/mp4" };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(req.url.split("?")[0]);
    const file = join(root, p === "/" ? "index.html" : p);
    const body = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;
console.log("serving", base);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
page.on("requestfailed", (r) => errors.push("requestfailed: " + r.url()));
await page.goto(base, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
const font = await page.evaluate(() => document.fonts.check('16px "LXGW WenKai"'));
const imgs = await page.evaluate(() => [...document.images].map((i) => ({ src: i.getAttribute("src"), ok: i.naturalWidth > 0 })));
console.log("font:", font, "| images:", imgs.length, "| broken:", imgs.filter((i) => !i.ok).map((i) => i.src).join(",") || "none");
await page.screenshot({ path: join(shots, "00-hero.png"), clip: { x: 0, y: 0, width: 1440, height: 900 } });

async function shot(sel, name, fn) {
  const el = await page.$(sel);
  if (!el) { errors.push("missing " + sel); return; }
  await el.scrollIntoViewIfNeeded();
  if (fn) await fn();
  await page.waitForTimeout(240);
  const box = await el.boundingBox();
  await page.screenshot({ path: join(shots, name), clip: { x: Math.max(0, box.x - 6), y: Math.max(0, box.y - 6), width: Math.min(1440, box.width + 12), height: Math.min(2400, box.height + 12) } });
}

/* D1 准入法庭：切消息 + 切模式 + 改格子 */
await shot("#d1", "01-d1-default.png");
await shot("#d1", "02-d1-alice.png", async () => {
  await page.locator("#d1-case input[value=alice]").check();
});
await shot("#d1", "03-d1-auto.png", async () => {
  await page.locator("input[name=d1m][value=auto]").check();
});
await shot("#d1", "04-d1-cell.png", async () => {
  await page.locator('.ad-cell[data-k=unlisted-ping][data-v=explicit]').click();
});

/* D2 工单阶段机：ready → blocked → 人的消息 */
await shot("#d2", "05-d2-ready.png", async () => { await page.click("#d2-ready"); });
await shot("#d2", "06-d2-blocked.png", async () => { await page.click("#d2-blocked"); });
await shot("#d2", "07-d2-human.png", async () => { await page.click("#d2-human"); });

/* D3 效果队列：派活 + 渠道抖动 */
await shot("#d3", "08-d3-run.png", async () => { await page.click("#d3-run"); });
await shot("#d3", "09-d3-storm.png", async () => { await page.click("#d3-storm"); });

/* D4 权力栈：issue 拒绝 → 名单放行 → 规则受限放行 */
await shot("#d4", "10-d4-issue.png");
await shot("#d4", "11-d4-listed.png", async () => {
  await page.locator('#d4-choose button[data-id=listed]').click();
});
await shot("#d4", "12-d4-rule.png", async () => {
  await page.locator('#d4-choose button[data-id=rule]').click();
});

/* 移动端：375 宽溢出检查 */
const mp = await browser.newPage({ viewport: { width: 375, height: 720 }, deviceScaleFactor: 2 });
mp.on("pageerror", (e) => errors.push("m-pageerror: " + e.message));
await mp.goto(base, { waitUntil: "networkidle" });
await mp.evaluate(() => document.fonts.ready);
const overflow = await mp.evaluate(() => {
  const bad = [];
  const dw = document.documentElement.clientWidth;
  document.querySelectorAll("body *").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && (r.right > dw + 1 || r.left < -1)) {
      if (el.closest(".tablewrap, .code, .ef-queue, .tk-log, .tk-trace, .ad-board")) return;
      const cls = (el.className && el.className.toString().slice(0, 40)) || el.tagName;
      bad.push(cls + " right=" + Math.round(r.right));
    }
  });
  return { scrollW: document.documentElement.scrollWidth, clientW: dw, bad: [...new Set(bad)].slice(0, 12) };
});
console.log("mobile overflow:", JSON.stringify(overflow));
await mp.screenshot({ path: join(shots, "13-mobile-hero.png") });

console.log("errors:", errors.length ? errors : "none");
await browser.close();
server.close();
