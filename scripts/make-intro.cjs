/**
 * アニメーションのイントロと課題パートを HTML/CSS で描き、1フレームずつ撮って mp4 にする。
 *   node scripts/make-intro.cjs            → captures/anim/intro.mp4, problem.mp4
 * 仕組み：CSS アニメーションを一時停止し、--t（秒）を動かしてフレームを撮る（決定的に描ける）。
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { execFileSync } = require("child_process");

const FPS = 30;
const FONT_DIR = path.resolve("node_modules/@fontsource/noto-sans-jp/files");
const FONT_CSS = ["400", "700", "900"]
  .map((w) => fs.readFileSync(path.join(FONT_DIR, "..", `${w}.css`), "utf8").replace(/url\(\.\/files\//g, `url(file://${FONT_DIR}/`))
  .join("\n");
const OUT = "captures/anim";

const BASE_CSS = `
  ${FONT_CSS}
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: "Noto Sans JP", sans-serif; }
  html, body { width: 1920px; height: 1080px; overflow: hidden; background: #0B1220; color: #F8FAFC; }
  .a { animation-play-state: paused !important; animation-fill-mode: both !important; animation-delay: calc((var(--d, 0) - var(--t)) * 1s) !important; }
  .stage { position: absolute; inset: 0; }
`;

/** 錠剤（白い丸）。mm → px は 1mm = 22px */
function tablet(x, y, mm, imprint, score, delay, flipAt) {
  const px = mm * 22;
  return `
  <div class="a tab" style="left:${x}px; top:${y}px; width:${px}px; height:${px}px; animation: pop 0.7s cubic-bezier(.2,1.4,.4,1) both; --d:${delay};">
    <div class="a flip" style="animation: flip 0.9s ease-in-out both; --d:${flipAt};">
      <div class="face back"></div>
      <div class="face front">${score ? '<div class="score"></div>' : ""}<span>${imprint}</span></div>
    </div>
  </div>`;
}

const INTRO_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  ${BASE_CSS}
  .tab { position: absolute; perspective: 900px; }
  .flip { width: 100%; height: 100%; position: relative; transform-style: preserve-3d; }
  .face { position: absolute; inset: 0; border-radius: 50%; backface-visibility: hidden; display: flex; align-items: center; justify-content: center;
          background: radial-gradient(circle at 35% 30%, #FFFFFF 0%, #ECEDE8 55%, #CFD2CA 100%); box-shadow: 0 30px 60px rgba(0,0,0,.55), inset 0 -8px 18px rgba(0,0,0,.08); }
  .face.front { transform: rotateY(180deg); font-family: ui-monospace, "Noto Sans JP", monospace; font-weight: 700; color: #475569; font-size: 46px; letter-spacing: .02em; }
  .face.front span { position: relative; text-shadow: 0 1px 0 #fff; }
  .score { position: absolute; left: 50%; top: 10%; bottom: 10%; width: 3px; background: rgba(71,85,105,.45); transform: translateX(-50%); }
  @keyframes pop { from { opacity: 0; transform: translateY(80px) scale(.6); } to { opacity: 1; transform: translateY(0) scale(1); } }
  @keyframes flip { from { transform: rotateY(0deg); } to { transform: rotateY(180deg); } }
  .line { position: absolute; left: 0; right: 0; text-align: center; font-weight: 900; }
  .q1 { top: 150px; font-size: 92px; animation: slideIn .8s cubic-bezier(.2,.9,.3,1) both; --d: 2.6; }
  .q2 { top: 270px; font-size: 92px; animation: slideIn .8s cubic-bezier(.2,.9,.3,1) both; --d: 3.4; }
  .q3 { top: 860px; font-size: 54px; font-weight: 400; color: #CBD5E1; animation: slideIn .8s ease-out both; --d: 7.2; }
  @keyframes slideIn { from { opacity: 0; transform: translateY(40px); } to { opacity: 1; transform: translateY(0); } }
  .qmark { position: absolute; font-size: 120px; font-weight: 900; color: #FBBF24; animation: qpop .5s cubic-bezier(.2,1.6,.4,1) both; text-shadow: 0 10px 30px rgba(0,0,0,.5); }
  @keyframes qpop { from { opacity: 0; transform: scale(0) rotate(-20deg); } to { opacity: 1; transform: scale(1) rotate(0); } }
  .fade { animation: fadeOut .6s ease-in both; --d: 10.8; }
  @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
  .title { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; animation: titleIn 1s cubic-bezier(.2,.9,.3,1) both; --d: 11.3; }
  .title h1 { font-size: 140px; font-weight: 900; letter-spacing: .04em; }
  .title .bar { width: 0; height: 10px; background: #FBBF24; margin: 30px 0; animation: grow .8s ease-out both; --d: 12.0; }
  .title p { font-size: 48px; color: #CBD5E1; animation: slideIn .8s ease-out both; --d: 12.4; }
  @keyframes titleIn { from { opacity: 0; transform: scale(.92); } to { opacity: 1; transform: scale(1); } }
  @keyframes grow { from { width: 0; } to { width: 420px; } }
</style></head><body>
<div class="stage fade a">
  ${tablet(560, 450, 8.0, "TYP0.5", false, 0.3, 5.6)}
  ${tablet(860, 470, 7.1, "GS 13", false, 0.9, 5.9)}
  ${tablet(1150, 480, 6.5, "Tw141", true, 1.5, 6.2)}
  <div class="a line q1">この1包、</div>
  <div class="a line q2">処方どおりだと言い切れますか？</div>
  <div class="a qmark" style="left:600px; top:330px; --d:4.4;">?</div>
  <div class="a qmark" style="left:900px; top:350px; --d:4.7;">?</div>
  <div class="a qmark" style="left:1180px; top:360px; --d:5.0;">?</div>
  <div class="a line q3">白い丸い錠剤が3つ。どれが、どの薬か。</div>
</div>
<div class="a title">
  <h1>一包化監査アシスト</h1>
  <div class="a bar"></div>
  <p>判断するのは薬剤師。アプリは、調べる手間を減らす道具。</p>
</div>
</body></html>`;

/** 課題パート：袋が増えて 120 になる → 要点が1つずつ */
function bags() {
  let s = "";
  for (let i = 0; i < 120; i++) {
    const col = i % 20, row = Math.floor(i / 20);
    s += `<div class="a bag" style="left:${150 + col * 82}px; top:${300 + row * 62}px; --d:${(i * 0.045).toFixed(3)};"></div>`;
  }
  return s;
}
const PROBLEM_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  ${BASE_CSS}
  body { background: #F8FAFC; color: #1E293B; }
  .kicker { position: absolute; left: 150px; top: 90px; font-size: 36px; font-weight: 700; color: #B45309; letter-spacing: .08em; animation: slideIn .6s ease-out both; --d: 0; }
  .h { position: absolute; left: 150px; top: 140px; font-size: 60px; white-space: nowrap; font-weight: 900; animation: slideIn .8s ease-out both; --d: .2; }
  .bag { position: absolute; width: 64px; height: 48px; border-radius: 8px; background: #fff; border: 3px solid #94A3B8; box-shadow: 0 4px 10px rgba(0,0,0,.08); animation: bagIn .35s cubic-bezier(.2,1.4,.4,1) both; }
  .bag::after { content: ""; position: absolute; left: 10px; right: 10px; top: 12px; height: 6px; background: #CBD5E1; border-radius: 3px; }
  @keyframes bagIn { from { opacity: 0; transform: scale(.3); } to { opacity: 1; transform: scale(1); } }
  .count { position: absolute; left: 150px; top: 700px; font-size: 120px; font-weight: 900; color: #B45309; animation: slideIn .6s ease-out both; --d: 5.6; }
  .count small { font-size: 48px; color: #475569; font-weight: 700; margin-left: 20px; }
  .first { position: absolute; left: 150px; top: 300px; width: 64px; height: 48px; border-radius: 8px; border: 6px solid #B45309; box-shadow: 0 0 0 12px rgba(180,83,9,.25); animation: ring .8s ease-out both; --d: 7.0; }
  @keyframes ring { from { opacity: 0; transform: scale(2); } to { opacity: 1; transform: scale(1); } }
  .note { position: absolute; left: 150px; top: 870px; font-size: 54px; font-weight: 700; animation: slideIn .7s ease-out both; --d: 7.4; }
  .points { position: absolute; left: 150px; top: 320px; right: 150px; animation: fadeIn .5s ease-out both; --d: 10.5; }
  .bagsWrap { animation: fadeOut .5s ease-in both; --d: 10.0; }
  .points li { list-style: none; font-size: 56px; line-height: 1.4; margin-bottom: 44px; padding-left: 70px; position: relative; animation: slideIn .6s ease-out both; }
  .points li::before { content: ""; position: absolute; left: 14px; top: 30px; width: 24px; height: 24px; border-radius: 50%; background: #B45309; }
  @keyframes slideIn { from { opacity: 0; transform: translateY(40px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
</style></head><body>
  <div class="a kicker">課題</div>
  <div class="a h">病院や薬局の薬剤師が毎日やっている「1包目の監査」</div>
  <div class="a bagsWrap stage">
    ${bags()}
    <div class="a count">120<small>包（30日分：朝・昼・夕・寝る前）</small></div>
    <div class="a first"></div>
    <div class="a note">いちばん時間がかかるのが、1包目。ここが残りの基準になる</div>
  </div>
  <ul class="a points">
    <li class="a" style="--d:11.0">同じ成分でも、作る会社ごとに見た目が違う</li>
    <li class="a" style="--d:13.5">新人や応援は見慣れない薬ばかり。50代以降は刻印が見えない</li>
    <li class="a" style="--d:16.5">見逃すといちばん危ないのは、似た見た目の違う薬</li>
  </ul>
</body></html>`;


/** 挨拶カット：白衣の薬剤師（フラットなイラスト）が手を振る。まばたき・上下の揺れ・腕振り */
const GREETING_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  ${BASE_CSS}
  body { background: linear-gradient(180deg, #EAF3FB 0%, #DCEBF7 100%); color: #1E293B; }
  .counter { position: absolute; left: 0; right: 0; bottom: 0; height: 300px; background: #BFD8EC; }
  .counter::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 26px; background: #A9C9E2; }
  .shelf { position: absolute; left: 1180px; top: 150px; width: 560px; height: 420px; background: #F6FAFD; border: 6px solid #CFE0EE; border-radius: 18px; }
  .shelf i { position: absolute; display: block; height: 70px; border-radius: 10px; }
  .char { position: absolute; left: 330px; top: 120px; width: 620px; height: 820px; animation: bob 2.4s ease-in-out infinite; }
  @keyframes bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-14px); } }
  .arm { transform-origin: 452px 395px; animation: wave 1.1s ease-in-out infinite; }
  @keyframes wave { 0%,100% { transform: rotate(-8deg); } 50% { transform: rotate(22deg); } }
  .eye { transform-origin: center; animation: blink 3.2s ease-in-out infinite; }
  @keyframes blink { 0%, 92%, 100% { transform: scaleY(1); } 95% { transform: scaleY(.1); } }
  .bubble { position: absolute; left: 980px; top: 620px; background: #fff; border-radius: 40px; padding: 34px 54px; font-size: 64px; font-weight: 900; box-shadow: 0 14px 40px rgba(0,0,0,.12); animation: pop .6s cubic-bezier(.2,1.5,.4,1) both; --d: 0.8; }
  .bubble::before { content: ""; position: absolute; left: -26px; top: 60px; border: 22px solid transparent; border-right-color: #fff; }
  .cap { position: absolute; left: 0; right: 0; bottom: 60px; text-align: center; font-size: 46px; font-weight: 700; color: #334155; animation: slideIn .7s ease-out both; --d: 1.6; }
  @keyframes pop { from { opacity: 0; transform: scale(.4); } to { opacity: 1; transform: scale(1); } }
  @keyframes slideIn { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
</style></head><body>
  <div class="shelf">
    <i style="left:30px; top:40px; width:90px; background:#F9A8D4"></i><i style="left:140px; top:40px; width:120px; background:#FDE68A"></i><i style="left:280px; top:40px; width:80px; background:#A7F3D0"></i><i style="left:380px; top:40px; width:140px; background:#BFDBFE"></i>
    <i style="left:30px; top:160px; width:130px; background:#C7D2FE"></i><i style="left:180px; top:160px; width:90px; background:#FECACA"></i><i style="left:290px; top:160px; width:110px; background:#FDE68A"></i><i style="left:420px; top:160px; width:100px; background:#A7F3D0"></i>
    <i style="left:30px; top:280px; width:100px; background:#BFDBFE"></i><i style="left:150px; top:280px; width:140px; background:#F9A8D4"></i><i style="left:310px; top:280px; width:90px; background:#C7D2FE"></i><i style="left:420px; top:280px; width:100px; background:#FECACA"></i>
  </div>
  <div class="counter"></div>
  <svg class="a char" viewBox="0 0 620 820" xmlns="http://www.w3.org/2000/svg">
    <!-- 体（白衣） -->
    <path d="M150 400 Q310 360 470 400 L500 820 L120 820 Z" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="6"/>
    <path d="M310 400 L270 460 L310 820 L350 460 Z" fill="#DCE7F2"/>
    <path d="M250 400 L310 470 L370 400" fill="none" stroke="#CBD5E1" stroke-width="6"/>
    <!-- 左腕（下ろす） -->
    <path d="M160 420 Q110 560 140 700" fill="none" stroke="#FFFFFF" stroke-width="64" stroke-linecap="round"/>
    <path d="M160 420 Q110 560 140 700" fill="none" stroke="#CBD5E1" stroke-width="72" stroke-linecap="round" opacity=".35"/>
    <circle cx="140" cy="720" r="34" fill="#F6D2B5"/>
    <!-- 右腕（振る） -->
    <g class="a arm">
      <path d="M452 395 Q520 300 560 190" fill="none" stroke="#CBD5E1" stroke-width="72" stroke-linecap="round" opacity=".35"/>
      <path d="M452 395 Q520 300 560 190" fill="none" stroke="#FFFFFF" stroke-width="64" stroke-linecap="round"/>
      <circle cx="562" cy="170" r="36" fill="#F6D2B5"/>
    </g>
    <!-- 首・顔 -->
    <rect x="280" y="330" width="60" height="70" rx="20" fill="#F6D2B5"/>
    <circle cx="310" cy="240" r="120" fill="#F6D2B5"/>
    <!-- 髪 -->
    <path d="M190 230 Q200 100 310 100 Q420 100 430 230 Q400 150 310 150 Q220 150 190 230 Z" fill="#3B3B4F"/>
    <!-- 目・口・ほほ -->
    <g class="a eye"><ellipse cx="268" cy="245" rx="10" ry="14" fill="#1E293B"/></g>
    <g class="a eye"><ellipse cx="352" cy="245" rx="10" ry="14" fill="#1E293B"/></g>
    <path d="M280 290 Q310 318 340 290" fill="none" stroke="#1E293B" stroke-width="7" stroke-linecap="round"/>
    <circle cx="245" cy="280" r="14" fill="#F9A8A8" opacity=".7"/><circle cx="375" cy="280" r="14" fill="#F9A8A8" opacity=".7"/>
    <!-- 名札 -->
    <rect x="360" y="470" width="80" height="44" rx="8" fill="#FDE68A" stroke="#D4B106" stroke-width="3"/>
  </svg>
  <div class="a bubble">はじめまして</div>
  <div class="a cap">病院で働く、現役の薬剤師です</div>
</body></html>`;

async function render(page, html, name, seconds) {
  const dir = path.join(OUT, name); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const n = Math.round(seconds * FPS);
  for (let i = 0; i < n; i++) {
    await page.evaluate((t) => document.documentElement.style.setProperty("--t", String(t)), i / FPS);
    await page.screenshot({ path: path.join(dir, `f${String(i).padStart(5, "0")}.jpg`), type: "jpeg", quality: 92 });
  }
  const mp4 = path.join(OUT, `${name}.mp4`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(dir, "f%05d.jpg"), "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", mp4]);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("wrote", mp4, `${seconds}s`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  const which = process.argv[2];
  if (!which || which === "intro") await render(page, INTRO_HTML, "intro", 15);
  if (!which || which === "problem") await render(page, PROBLEM_HTML, "problem", 22);
  if (which === "greeting") await render(page, GREETING_HTML, "greeting", 6);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
