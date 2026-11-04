/**
 * マスタ（data/master.csv）をPC画面の表として描き、ゆっくりスクロールする動画を録る（デモ動画 #17 用）。
 *   node scripts/make-master-scroll.cjs captures/live/github.mp4
 * GitHub の画面はこの環境から CSS が読めないため、同じ内容を自前の表で見せる。
 */
const fs = require("fs"); const path = require("path"); const { chromium } = require("playwright"); const { execFileSync } = require("child_process");
const OUT = process.argv[2] || "captures/live/github.mp4";
const FONT_DIR = path.resolve("node_modules/@fontsource/noto-sans-jp/files");
const FONT_CSS = ["400", "700"].map((w) => fs.readFileSync(path.join(FONT_DIR, "..", `${w}.css`), "utf8").replace(/url\(\.\/files\//g, "url(http://fonts.local/files/")).join("\n");
const master = JSON.parse(fs.readFileSync("data/master.json", "utf8"));
const cols = [["brand_name", "販売名"], ["imprint_front", "刻印（表）"], ["imprint_back", "刻印（裏）"], ["color", "色"], ["size_long_mm", "長径mm"], ["source_quote", "添付文書の記載（抜粋）"], ["source_revision", "改訂"], ["verified_by", "確認者"], ["verified_at", "確認日"], ["status", "状態"]];
const rows = master.map((t) => `<tr>${cols.map(([k]) => `<td class="${k}">${String(t[k] ?? "").replace(/</g, "&lt;")}</td>`).join("")}</tr>`).join("");
const html = `<!doctype html><html><head><meta charset="utf-8"><style>${FONT_CSS}
  * { box-sizing: border-box; font-family: "Noto Sans JP", sans-serif; }
  body { margin: 0; background: #F6F8FA; color: #1F2328; }
  .top { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #D0D7DE; padding: 18px 40px; font-size: 22px; display: flex; gap: 24px; align-items: center; z-index: 2; }
  .top b { font-weight: 700; } .top .path { color: #0969DA; } .top .meta { color: #656D76; font-size: 18px; margin-left: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 19px; background: #fff; }
  th { position: sticky; top: 64px; background: #F6F8FA; text-align: left; padding: 12px 14px; border-bottom: 2px solid #D0D7DE; font-weight: 700; z-index: 1; }
  td { padding: 12px 14px; border-bottom: 1px solid #E5E7EB; vertical-align: top; max-width: 520px; }
  td.source_quote { color: #57606A; font-size: 16px; max-width: 640px; }
  td.status { color: #1A7F37; font-weight: 700; } td.verified_by { font-weight: 700; }
  tr:nth-child(even) td { background: #FBFCFD; }
</style></head><body>
  <div class="top"><b>aki-pharm / ippouka-audit-assist</b><span class="path">data / master.csv</span><span class="meta">28品目・すべて verified（確認者・確認日つき）・出典は PMDA 添付文書</span></div>
  <table><thead><tr>${cols.map(([, l]) => `<th>${l}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
  <div style="height:300px"></div>
</body></html>`;
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } }); const p = await ctx.newPage();
  await p.route("http://fonts.local/**", (route) => { const rel = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\//, "")); const file = path.join(FONT_DIR, "..", rel); route.fulfill({ status: 200, contentType: "font/woff2", body: fs.readFileSync(file) }); });
  await p.setContent(html, { waitUntil: "load" }); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(400);
  const dir = "captures/tmp/master-scroll"; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  // 1フレームずつ：最初 1.2 秒止めて、ゆっくり下へ（約 10 秒）、最後に少し止める
  const FPS = 30; let i = 0;
  const shot = async () => { await p.screenshot({ path: path.join(dir, `f${String(i++).padStart(5, "0")}.jpg`), type: "jpeg", quality: 90 }); };
  for (let k = 0; k < 1.2 * FPS; k++) await shot();
  const total = await p.evaluate(() => document.body.scrollHeight - innerHeight);
  const steps = 10 * FPS;
  for (let k = 1; k <= steps; k++) { await p.evaluate((y) => window.scrollTo(0, y), Math.round((total * k) / steps)); await shot(); }
  for (let k = 0; k < 1.5 * FPS; k++) await shot();
  await b.close();
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(dir, "f%05d.jpg"), "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", OUT]);
  console.log("wrote", OUT);
})();
