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
const FONT_CSS = ["400", "700"]
  .map((w) => fs.readFileSync(path.join(FONT_DIR, "..", `${w}.css`), "utf8").replace(/url\(\.\/files\//g, "url(http://fonts.local/files/"))
  .join("\n");

/** @fontsource の woff2 を http://fonts.local/ で配る（about:blank からは file:// が読めないため） */
async function serveFonts(page) {
  await page.route("http://fonts.local/**", (route) => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\//, ""));
    const file = path.join(FONT_DIR, "..", rel);
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: "" });
    route.fulfill({ status: 200, contentType: file.endsWith(".woff2") ? "font/woff2" : "font/woff", body: fs.readFileSync(file) });
  });
}

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
  .line { position: absolute; left: 0; right: 0; text-align: center; font-weight: 700; }
  .q1 { top: 150px; font-size: 92px; animation: slideIn .8s cubic-bezier(.2,.9,.3,1) both; --d: 2.6; }
  .q2 { top: 270px; font-size: 92px; animation: slideIn .8s cubic-bezier(.2,.9,.3,1) both; --d: 3.4; }
  .q3 { top: 860px; font-size: 54px; font-weight: 400; color: #CBD5E1; animation: slideIn .8s ease-out both; --d: 7.2; }
  @keyframes slideIn { from { opacity: 0; transform: translateY(40px); } to { opacity: 1; transform: translateY(0); } }
  .qmark { position: absolute; font-size: 120px; font-weight: 700; color: #FBBF24; animation: qpop .5s cubic-bezier(.2,1.6,.4,1) both; text-shadow: 0 10px 30px rgba(0,0,0,.5); }
  @keyframes qpop { from { opacity: 0; transform: scale(0) rotate(-20deg); } to { opacity: 1; transform: scale(1) rotate(0); } }
  .fade { animation: fadeOut .6s ease-in both; --d: 10.8; }
  @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
  .title { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; animation: titleIn 1s cubic-bezier(.2,.9,.3,1) both; --d: 11.3; }
  .title h1 { font-size: 140px; font-weight: 700; letter-spacing: .04em; }
  .title .bar { width: 0; height: 10px; background: #FBBF24; margin: 30px 0; animation: grow .8s ease-out both; --d: 12.0; }
  .title p { font-size: 48px; color: #CBD5E1; animation: slideIn .8s ease-out both; --d: 12.4; }
  @keyframes titleIn { from { opacity: 0; transform: scale(.92); } to { opacity: 1; transform: scale(1); } }
  @keyframes grow { from { width: 0; } to { width: 420px; } }
</style></head><body>
<div class="stage fade a">
  ${tablet(560, 450, 8.0, "TYP0.5", false, 0.3, 5.6)}
  ${tablet(860, 470, 7.1, "GS 13", false, 0.9, 5.9)}
  ${tablet(1150, 480, 6.5, "Tw141", true, 1.5, 6.2)}
  <div class="a line q1">白い丸い錠剤が、三つ。</div>
  <div class="a line q2">どれが、どの薬か、分かりますか？</div>
  <div class="a qmark" style="left:600px; top:330px; --d:4.4;">?</div>
  <div class="a qmark" style="left:900px; top:350px; --d:4.7;">?</div>
  <div class="a qmark" style="left:1180px; top:360px; --d:5.0;">?</div>
  <div class="a line q3">見分けがつきますか？</div>
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
  .h { position: absolute; left: 150px; top: 140px; font-size: 60px; white-space: nowrap; font-weight: 700; animation: slideIn .8s ease-out both; --d: .2; }
  .bag { position: absolute; width: 64px; height: 48px; border-radius: 8px; background: #fff; border: 3px solid #94A3B8; box-shadow: 0 4px 10px rgba(0,0,0,.08); animation: bagIn .35s cubic-bezier(.2,1.4,.4,1) both; }
  .bag::after { content: ""; position: absolute; left: 10px; right: 10px; top: 12px; height: 6px; background: #CBD5E1; border-radius: 3px; }
  @keyframes bagIn { from { opacity: 0; transform: scale(.3); } to { opacity: 1; transform: scale(1); } }
  .count { position: absolute; left: 150px; top: 700px; font-size: 120px; font-weight: 700; color: #B45309; animation: slideIn .6s ease-out both; --d: 5.6; }
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
    <li class="a" style="--d:11.0">同じ成分でも、製薬会社ごとに見た目が違う</li>
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
  .bubble { position: absolute; left: 980px; top: 620px; background: #fff; border-radius: 40px; padding: 34px 54px; font-size: 64px; font-weight: 700; box-shadow: 0 14px 40px rgba(0,0,0,.12); animation: pop .6s cubic-bezier(.2,1.5,.4,1) both; --d: 0.8; }
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
    <path d="M310 400 L270 460 L310 820 L350 460 Z" fill="#2B2B3A"/>
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
    <!-- 後ろ髪（茶色、ミディアム：肩に少しかかる） -->
    <path d="M196 230 Q176 360 206 430 Q250 440 262 400 L262 320 Z" fill="#4A3220"/>
    <path d="M424 230 Q444 360 414 430 Q370 440 358 400 L358 320 Z" fill="#4A3220"/>
    <!-- 首・顔 -->
    <rect x="280" y="330" width="60" height="70" rx="20" fill="#F6D2B5"/>
    <circle cx="310" cy="240" r="120" fill="#F6D2B5"/>
    <!-- 前髪（茶色、斜めに流す） -->
    <path d="M190 240 Q195 95 310 100 Q425 95 430 240 Q405 165 335 172 Q300 150 268 190 Q238 214 190 240 Z" fill="#553A26"/>
    <path d="M300 150 Q365 150 412 205 Q380 182 332 190 Z" fill="#64452D"/>
    <!-- 目（閉じて微笑む）・口・ほほ -->
    <path d="M250 250 Q268 236 286 250" fill="none" stroke="#1E293B" stroke-width="6" stroke-linecap="round"/>
    <path d="M334 250 Q352 236 370 250" fill="none" stroke="#1E293B" stroke-width="6" stroke-linecap="round"/>
    <path d="M284 292 Q310 314 336 292" fill="none" stroke="#1E293B" stroke-width="7" stroke-linecap="round"/>
    <circle cx="245" cy="282" r="14" fill="#F9A8A8" opacity=".7"/><circle cx="375" cy="282" r="14" fill="#F9A8A8" opacity=".7"/>
    <!-- 名札 -->
    <rect x="360" y="470" width="80" height="44" rx="8" fill="#FDE68A" stroke="#D4B106" stroke-width="3"/>
  </svg>
</body></html>`;


/** 一包化とは：PTP から錠剤が出て袋にまとまる → 薬が多くて困る人 → 袋を受け取って安心 */
function ptp(x, y, color, d) {
  let cells = "";
  for (let r = 0; r < 5; r++) for (let c = 0; c < 2; c++) cells += `<i style="left:${26 + c * 62}px; top:${22 + r * 52}px; background:${color}"></i>`;
  return `<div class="a ptp" style="left:${x}px; top:${y}px; --d:${d}">${cells}</div>`;
}
const IPPOUKA_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  ${BASE_CSS}
  body { background: #F8FAFC; color: #1E293B; }
  .ptp { position: absolute; width: 170px; height: 300px; border-radius: 12px; background: #E2E8F0; border: 3px solid #CBD5E1; animation: slideUp .6s cubic-bezier(.2,1.2,.4,1) both; }
  .ptp i { position: absolute; width: 42px; height: 36px; border-radius: 50%; box-shadow: inset 0 -3px 4px rgba(0,0,0,.12); }
  @keyframes slideUp { from { opacity: 0; transform: translateY(120px); } to { opacity: 1; transform: translateY(0); } }
  .pill { position: absolute; z-index: 2; width: 38px; height: 32px; border-radius: 50%; box-shadow: 0 6px 12px rgba(0,0,0,.18); animation: fly 1.1s cubic-bezier(.3,.6,.3,1) both; }
  @keyframes fly { 0% { transform: translate(0,0) scale(1); opacity: 1; } 100% { transform: translate(var(--dx), var(--dy)) scale(.9); opacity: 1; } }
  .bag { position: absolute; width: 200px; height: 240px; border-radius: 16px; background: #fff; border: 4px solid #94A3B8; animation: pop .6s cubic-bezier(.2,1.4,.4,1) both; }
  .bag::before { content: ""; position: absolute; left: 14px; right: 14px; top: 14px; height: 10px; border-radius: 5px; background: #CBD5E1; }
  .bag b { position: absolute; left: 0; right: 0; top: 30px; text-align: center; font-size: 34px; font-weight: 700; color: #334155; }
  .bag i { position: absolute; width: 38px; height: 32px; border-radius: 50%; box-shadow: 0 4px 8px rgba(0,0,0,.15); animation: pop .4s ease-out both; }
  @keyframes pop { from { opacity: 0; transform: scale(.4); } to { opacity: 1; transform: scale(1); } }
  .cap { position: absolute; left: 0; right: 0; text-align: center; font-weight: 700; animation: slideIn .7s ease-out both; }
  @keyframes slideIn { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  .s1 { animation: fadeOut .6s ease-in both; --d: 7.2; }
  .s2 { position: absolute; inset: 0; animation: fadeIn .6s ease-out both; --d: 7.6; }
  .person { position: absolute; left: 520px; top: 300px; width: 300px; height: 420px; animation: bob 2.6s ease-in-out infinite; }
  @keyframes bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
  .mouthSad { animation: fadeOut .3s both; --d: 11.4; } .mouthHappy { animation: fadeIn .3s both; --d: 11.4; }
  .sweat { animation: fadeOut .3s both; --d: 11.4; }
  .q { position: absolute; font-size: 90px; font-weight: 700; color: #B45309; animation: pop .5s cubic-bezier(.2,1.6,.4,1) both; }
  .qs { animation: fadeOut .3s both; --d: 11.3; }
  .hand { position: absolute; left: 1250px; top: 420px; animation: hand 1.2s ease-out both; --d: 10.4; }
  @keyframes hand { from { transform: translateX(260px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
  .ok { position: absolute; left: 1310px; top: 290px; font-size: 100px; color: #16A34A; font-weight: 700; animation: pop .5s cubic-bezier(.2,1.6,.4,1) both; --d: 11.6; }
</style></head><body>
<div class="a s1 stage">
  ${ptp(200, 330, "#FDE68A", 0.2)}${ptp(400, 330, "#FFFFFF", 0.4)}${ptp(600, 330, "#F9A8D4", 0.6)}${ptp(800, 330, "#BFDBFE", 0.8)}
  <!-- 各シートから1錠が袋へ飛ぶ -->
  <div class="a pill" style="left:265px; top:460px; background:#FDE68A; --dx:1000px; --dy:-20px; --d:1.6"></div>
  <div class="a pill" style="left:465px; top:460px; background:#FFFFFF; --dx:860px; --dy:30px; --d:1.9"></div>
  <div class="a pill" style="left:665px; top:460px; background:#F9A8D4; --dx:600px; --dy:60px; --d:2.2"></div>
  <div class="a pill" style="left:865px; top:460px; background:#BFDBFE; --dx:430px; --dy:95px; --d:2.5"></div>
  <div class="a bag" style="left:1200px; top:360px; --d:1.2"><b>朝</b></div>
  <div class="a bag" style="left:1440px; top:360px; --d:4.2"><b>昼</b><i style="left:50px; top:90px; background:#FFFFFF; --d:4.6"></i><i style="left:110px; top:120px; background:#F9A8D4; --d:4.7"></i></div>
  <div class="a bag" style="left:1680px; top:360px; --d:4.6"><b>夕</b><i style="left:40px; top:90px; background:#FDE68A; --d:5.0"></i><i style="left:100px; top:110px; background:#FFFFFF; --d:5.1"></i><i style="left:70px; top:160px; background:#BFDBFE; --d:5.2"></i></div>
  <div class="a cap" style="top:150px; font-size:72px; --d:0.2">一包化とは</div>
  <div class="a cap" style="top:760px; font-size:60px; --d:3.2">1回に飲む分の薬を、1つの袋にまとめること</div>
</div>
<div class="a s2">
  <!-- 困る人（高齢者） -->
  <svg class="person" viewBox="0 0 300 420">
    <circle cx="150" cy="110" r="80" fill="#F6D2B5"/>
    <path d="M70 110 Q75 30 150 30 Q225 30 230 110 Q210 70 150 75 Q90 70 70 110 Z" fill="#CBD5E1"/>
    <circle cx="120" cy="115" r="16" fill="none" stroke="#475569" stroke-width="5"/><circle cx="180" cy="115" r="16" fill="none" stroke="#475569" stroke-width="5"/><line x1="136" y1="115" x2="164" y2="115" stroke="#475569" stroke-width="5"/>
    <circle cx="120" cy="115" r="6" fill="#1E293B"/><circle cx="180" cy="115" r="6" fill="#1E293B"/>
    <path class="a mouthSad" d="M125 160 Q150 142 175 160" fill="none" stroke="#1E293B" stroke-width="6" stroke-linecap="round"/>
    <path class="a mouthHappy" d="M125 150 Q150 172 175 150" fill="none" stroke="#1E293B" stroke-width="6" stroke-linecap="round" opacity="0"/>
    <path class="a sweat" d="M235 70 Q250 95 235 100 Q220 95 235 70 Z" fill="#60A5FA"/>
    <path d="M60 420 L60 260 Q150 200 240 260 L240 420 Z" fill="#7C9CBF"/>
  </svg>
  <!-- まわりに大量のPTP -->
  ${ptp(220, 260, "#FDE68A", 8.0)}${ptp(260, 520, "#BFDBFE", 8.2)}${ptp(860, 240, "#F9A8D4", 8.4)}${ptp(900, 500, "#FFFFFF", 8.6)}${ptp(120, 400, "#A7F3D0", 8.8)}${ptp(1000, 380, "#FECACA", 9.0)}
  <div class="a q qs" style="left:400px; top:180px; --d:9.3">?</div>
  <div class="a q qs" style="left:820px; top:140px; --d:9.6">?</div>
  <!-- 薬剤師の手が袋を差し出す -->
  <div class="a hand">
    <div class="bag" style="position:relative; left:0; top:0; animation:none; opacity:1; background:#fff"><b>朝</b><i style="left:50px; top:90px; background:#FDE68A; animation:none; opacity:1"></i><i style="left:110px; top:120px; background:#FFFFFF; animation:none; opacity:1"></i><i style="left:70px; top:160px; background:#BFDBFE; animation:none; opacity:1"></i></div>
  </div>
  <div class="a ok">✓</div>
  <div class="a cap" style="top:120px; font-size:56px; --d:8.2">10種類を超える薬を飲む患者さんも珍しくありません</div>
  <div class="a cap" style="top:860px; font-size:56px; --d:12.0">きちんと飲めるように整えるのも、薬剤師の仕事</div>
</div>
</body></html>`;


/** 1包目が基準：120個の袋の上を光が走る → 1包目だけ拡大、残りが薄くなる → 「基準」、残りに「同じ？」✓ */
function bagsGrid(delayStep, extraClass = "") {
  let out = "";
  for (let i = 0; i < 120; i++) {
    const col = i % 20, row = Math.floor(i / 20);
    out += `<div class="a bag ${extraClass}" style="left:${150 + col * 82}px; top:${300 + row * 62}px; --d:${(i * delayStep).toFixed(3)}; --i:${i}"></div>`;
  }
  return out;
}
const FIRSTBAG_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  ${BASE_CSS}
  body { background: #F8FAFC; color: #1E293B; }
  .h { position: absolute; left: 150px; top: 120px; font-size: 60px; font-weight: 700; animation: slideIn .6s ease-out both; --d: 0; }
  .bag { position: absolute; width: 64px; height: 48px; border-radius: 8px; background: #fff; border: 3px solid #94A3B8; box-shadow: 0 4px 10px rgba(0,0,0,.08); animation: none; }
  .bag::after { content: ""; position: absolute; left: 10px; right: 10px; top: 12px; height: 6px; background: #CBD5E1; border-radius: 3px; }
  .sweep { position: absolute; top: 280px; width: 160px; height: 400px; background: linear-gradient(90deg, rgba(251,191,36,0) 0%, rgba(251,191,36,.55) 50%, rgba(251,191,36,0) 100%); animation: sweep 2.2s linear both, fadeOut .4s ease-in both; animation-delay: calc((0.6 - var(--t)) * 1s), calc((2.8 - var(--t)) * 1s) !important; }
  @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
  @keyframes sweep { from { left: 60px; } to { left: 1700px; } }
  .rest { animation: dim .8s ease-out both; --d: 3.4; }
  @keyframes dim { to { opacity: .22; } }
  .first { position: absolute; left: 150px; top: 300px; width: 64px; height: 48px; border-radius: 8px; background: #fff; border: 3px solid #B45309; transform-origin: 0 0; animation: grow 1s cubic-bezier(.2,.9,.3,1) both; --d: 3.4; box-shadow: 0 10px 30px rgba(0,0,0,.15); }
  .first::after { content: ""; position: absolute; left: 10px; right: 10px; top: 12px; height: 6px; background: #CBD5E1; border-radius: 3px; }
  @keyframes grow { to { transform: translate(120px, 0) scale(5); } }
  .label { position: absolute; left: 740px; top: 330px; font-size: 64px; font-weight: 700; color: #B45309; animation: slideIn .6s ease-out both; --d: 4.4; }
  .label small { display: block; font-size: 36px; color: #475569; font-weight: 700; margin-top: 10px; }
  .clock { position: absolute; left: 560px; top: 300px; width: 70px; height: 70px; border-radius: 50%; border: 6px solid #B45309; background: #fff; animation: pop .5s cubic-bezier(.2,1.6,.4,1) both; --d: 4.0; }
  .clock::before { content: ""; position: absolute; left: 50%; top: 10px; width: 5px; height: 26px; background: #B45309; transform-origin: 50% 100%; margin-left: -2px; animation: tick 2s linear infinite; }
  @keyframes tick { to { transform: rotate(360deg); } }
  .same { position: absolute; left: 740px; top: 560px; font-size: 40px; font-weight: 700; color: #334155; animation: slideIn .6s ease-out both; --d: 6.2; }
  .checks { position: absolute; left: 740px; top: 640px; display: flex; gap: 14px; }
  .checks i { width: 64px; height: 48px; border-radius: 8px; background: #fff; border: 3px solid #94A3B8; position: relative; animation: pop .35s cubic-bezier(.2,1.6,.4,1) both; }
  .checks i::after { content: "✓"; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #16A34A; font-weight: 700; font-size: 30px; }
  .cap { position: absolute; left: 150px; right: 150px; top: 880px; font-size: 48px; font-weight: 700; animation: slideIn .6s ease-out both; }
  @keyframes slideIn { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes pop { from { opacity: 0; transform: scale(.3); } to { opacity: 1; transform: scale(1); } }
</style></head><body>
  <div class="a h">その全部を、目で確かめます</div>
  <div class="a rest stage">${bagsGrid(0)}</div>
  <div class="a sweep"></div>
  <div class="a first"></div>
  <div class="a clock"></div>
  <div class="a label">1包目が、基準<small>いちばん時間がかかる</small></div>
  <div class="a same">残りは「1包目と同じか」を見ていく</div>
  <div class="checks">${[0,1,2,3,4,5,6,7,8,9,10,11].map((i)=>`<i class="a" style="--d:${(6.6+i*0.18).toFixed(2)}"></i>`).join("")}</div>
  <div class="a cap" style="--d:8.6">ここが基準になり、残りはそれと同じかを見ていきます</div>
</body></html>`;

/** 締め：錠剤3つが袋に収まり ✓ → 言葉が1行ずつ → スマホ → タイトル → クレジット */
const CLOSING_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  ${BASE_CSS}
  body { background: #0B1220; color: #F8FAFC; }
  .pill { position: absolute; width: 150px; height: 150px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #fff 0%, #ECEDE8 55%, #CFD2CA 100%); box-shadow: 0 20px 50px rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center; font: 700 34px ui-monospace, monospace; color: #475569; animation: gather 1.2s cubic-bezier(.2,.9,.3,1) both; }
  @keyframes gather { from { transform: translate(var(--fx), var(--fy)) scale(1); } to { transform: translate(0, 0) scale(.55); } }
  .bag { position: absolute; left: 810px; top: 300px; width: 300px; height: 360px; border-radius: 24px; border: 5px solid #94A3B8; background: rgba(255,255,255,.06); animation: pop .6s cubic-bezier(.2,1.4,.4,1) both; --d: .2; }
  .bag::before { content: ""; position: absolute; left: 20px; right: 20px; top: 20px; height: 12px; border-radius: 6px; background: #94A3B8; }
  .ok { position: absolute; left: 1080px; top: 250px; width: 110px; height: 110px; border-radius: 50%; background: #16A34A; color: #fff; font-size: 80px; font-weight: 700; display: flex; align-items: center; justify-content: center; animation: pop .5s cubic-bezier(.2,1.6,.4,1) both; --d: 2.0; box-shadow: 0 10px 30px rgba(0,0,0,.4); }
  .group { animation: fadeOut .6s ease-in both; --d: 4.2; }
  .line { position: absolute; left: 0; right: 0; text-align: center; font-weight: 700; animation: slideIn .8s cubic-bezier(.2,.9,.3,1) both; }
  .l1 { top: 300px; font-size: 92px; --d: 4.8; }
  .l2 { top: 440px; font-size: 64px; font-weight: 700; color: #CBD5E1; --d: 5.8; }
  .l3 { top: 600px; font-size: 54px; font-weight: 700; color: #FBBF24; --d: 7.0; }
  .words { animation: fadeOut .6s ease-in both; --d: 10.2; }
  .phone { position: absolute; left: 860px; top: 200px; width: 200px; height: 400px; border-radius: 34px; border: 8px solid #E2E8F0; background: #0F172A; animation: phoneIn 1s cubic-bezier(.2,.9,.3,1) both; --d: 10.6; overflow: hidden; }
  .phone i { position: absolute; left: 18px; right: 18px; height: 54px; border-radius: 10px; background: #1E293B; border: 2px solid #334155; }
  .phone b { position: absolute; width: 28px; height: 28px; border-radius: 50%; background: #F1F5F9; }
  @keyframes phoneIn { from { opacity: 0; transform: translateY(60px) scale(.9); } to { opacity: 1; transform: translateY(0) scale(1); } }
  .l4 { top: 640px; font-size: 54px; color: #E2E8F0; --d: 11.4; }
  .l5 { top: 730px; font-size: 54px; color: #FBBF24; --d: 12.6; }
  .title { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; animation: titleIn 1s cubic-bezier(.2,.9,.3,1) both; --d: 15.2; }
  .title h1 { font-size: 140px; font-weight: 700; letter-spacing: .04em; }
  .title .bar { width: 0; height: 10px; background: #FBBF24; margin: 30px 0; animation: grow .8s ease-out both; --d: 15.9; }
  .credit { position: absolute; left: 140px; right: 140px; bottom: 60px; display: flex; justify-content: space-between; font-size: 30px; color: #94A3B8; animation: slideIn .8s ease-out both; --d: 16.6; }
  .final { animation: fadeOut .6s ease-in both; --d: 14.8; }
  @keyframes pop { from { opacity: 0; transform: scale(.3); } to { opacity: 1; transform: scale(1); } }
  @keyframes slideIn { from { opacity: 0; transform: translateY(40px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
  @keyframes titleIn { from { opacity: 0; transform: scale(.92); } to { opacity: 1; transform: scale(1); } }
  @keyframes grow { from { width: 0; } to { width: 420px; } }
</style></head><body>
  <div class="a group stage">
    <div class="a bag"></div>
    <div class="a pill" style="left:900px; top:420px; --fx:-620px; --fy:-220px; --d:.5">TYP0.5</div>
    <div class="a pill" style="left:880px; top:470px; --fx:0px; --fy:-380px; --d:.8">GS 13</div>
    <div class="a pill" style="left:930px; top:500px; --fx:640px; --fy:-200px; --d:1.1">Tw141</div>
    <div class="a ok">✓</div>
  </div>
  <div class="a words stage">
    <div class="a line l1">判断するのは、薬剤師。</div>
    <div class="a line l2">アプリは、調べる手間を減らす道具。</div>
    <div class="a line l3">大きな機械は、いりません。</div>
  </div>
  <div class="a final stage">
    <div class="a phone"><i style="top:30px"></i><i style="top:100px"></i><i style="top:170px"></i><b style="left:40px; top:250px"></b><b style="left:86px; top:250px"></b><b style="left:132px; top:250px"></b><b style="left:62px; top:300px"></b><b style="left:110px; top:300px"></b></div>
    <div class="a line l4">どの施設でも、手元のスマホで。</div>
    <div class="a line l5">経験の差に、左右されない監査を。</div>
  </div>
  <div class="a title">
    <h1>一包化監査アシスト</h1>
    <div class="a bar"></div>
  </div>
  <div class="a credit"><span>Built with Claude: Japan 2026</span><span>VOICEVOX:もち子(cv 明日葉よもぎ)</span></div>
</body></html>`;


/** 新人薬剤師：白い錠剤の山を前に汗、「?」 */
function whitePile() {
  let out = ""; const seed = [0.13,0.71,0.42,0.88,0.27,0.59,0.95,0.05,0.66,0.34,0.81,0.19,0.48,0.76,0.23,0.9,0.37,0.62,0.08,0.54,0.29,0.84,0.45,0.72];
  const tints = ["#FFFFFF","#FFFFFF","#FBF7EA","#FFFFFF","#F3F4F6","#FFF9E6","#FFFFFF","#FDF2F8"];
  for (let i = 0; i < 24; i++) { const x = 960 + seed[i] * 640, y = 420 + seed[(i * 7) % 24] * 300, r = 44 + seed[(i * 3) % 24] * 30;
    const kind = i % 5; // 0,1,2: 丸 / 3: 楕円 / 4: 長円
    const w = kind === 3 ? r * 1.6 : kind === 4 ? r * 2.1 : r, h = kind === 4 ? r * 0.9 : r;
    const radius = kind === 4 ? `${h / 2}px` : "50%";
    out += `<div class="a wp" style="left:${x.toFixed(0)}px; top:${y.toFixed(0)}px; width:${w.toFixed(0)}px; height:${h.toFixed(0)}px; border-radius:${radius}; background: radial-gradient(circle at 35% 30%, #fff 0%, ${tints[i % tints.length]} 55%, #CFD2CA 100%); --d:${(0.4 + i * 0.07).toFixed(2)}"></div>`; }
  return out;
}
const NEWBIE_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  ${BASE_CSS}
  body { background: #EAF3FB; color: #1E293B; }
  .counter { position: absolute; left: 0; right: 0; bottom: 0; height: 300px; background: #BFD8EC; }
  .wp { position: absolute; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #fff 0%, #ECEDE8 60%, #CFD2CA 100%); box-shadow: 0 8px 16px rgba(0,0,0,.18); animation: drop .5s cubic-bezier(.2,1.2,.4,1) both; }
  @keyframes drop { from { opacity: 0; transform: translateY(-120px); } to { opacity: 1; transform: translateY(0); } }
  .char { position: absolute; left: 260px; top: 200px; width: 620px; height: 820px; animation: bob 2.4s ease-in-out infinite; }
  @keyframes bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
  .sweat { animation: sweatDrop 1.4s ease-in infinite; transform-origin: center; }
  @keyframes sweatDrop { 0% { transform: translateY(0); opacity: 1; } 100% { transform: translateY(40px); opacity: 0; } }
  .q { position: absolute; font-size: 110px; font-weight: 700; color: #B45309; animation: pop .5s cubic-bezier(.2,1.6,.4,1) both; }
  @keyframes pop { from { opacity: 0; transform: scale(0) rotate(-15deg); } to { opacity: 1; transform: scale(1) rotate(0); } }
  .cap { position: absolute; left: 0; right: 0; top: 90px; text-align: center; font-size: 60px; font-weight: 700; animation: slideIn .7s ease-out both; --d: 2.6; }
  @keyframes slideIn { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
</style></head><body>
  <div class="counter"></div>
  ${whitePile()}
  <svg class="char" viewBox="0 0 620 820">
    <path d="M150 400 Q310 360 470 400 L500 820 L120 820 Z" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="6"/>
    <path d="M310 400 L270 460 L310 820 L350 460 Z" fill="#2B2B3A"/>
    <path d="M160 420 Q110 560 140 700" fill="none" stroke="#FFFFFF" stroke-width="64" stroke-linecap="round"/><circle cx="140" cy="720" r="34" fill="#F6D2B5"/>
    <path d="M460 420 Q510 560 480 700" fill="none" stroke="#FFFFFF" stroke-width="64" stroke-linecap="round"/><circle cx="480" cy="720" r="34" fill="#F6D2B5"/>
    <rect x="280" y="330" width="60" height="70" rx="20" fill="#F6D2B5"/>
    <circle cx="310" cy="240" r="120" fill="#F6D2B5"/>
    <path d="M190 240 Q195 95 310 100 Q425 95 430 240 Q400 160 310 160 Q220 160 190 240 Z" fill="#2F2F3F"/>
    <ellipse cx="268" cy="248" rx="10" ry="14" fill="#1E293B"/><ellipse cx="352" cy="248" rx="10" ry="14" fill="#1E293B"/>
    <path d="M250 212 Q268 200 286 212" fill="none" stroke="#1E293B" stroke-width="6" stroke-linecap="round"/><path d="M334 212 Q352 200 370 212" fill="none" stroke="#1E293B" stroke-width="6" stroke-linecap="round"/>
    <path d="M286 300 Q310 286 334 300" fill="none" stroke="#1E293B" stroke-width="7" stroke-linecap="round"/>
    <path class="sweat" d="M440 170 Q458 200 440 208 Q422 200 440 170 Z" fill="#60A5FA"/>
    <rect x="360" y="470" width="80" height="44" rx="8" fill="#A7F3D0" stroke="#10B981" stroke-width="3"/>
  </svg>
  <div class="a q" style="left:640px; top:200px; --d:2.0">?</div>
  <div class="a q" style="left:780px; top:260px; --d:2.3; font-size:80px">?</div>
  <div class="a cap">新人や応援の薬剤師には、見慣れない薬ばかり</div>
</body></html>`;

/** 会社違いの錠剤が画面いっぱいにスクロール */
function varietyRow(y, speed, seedOff) {
  const colors = ["#FFFFFF","#FDE68A","#FBCFE8","#BFDBFE","#FFFFFF","#FECACA","#F5F5DC","#A7F3D0","#FFFFFF","#E9D5FF","#FFFFFF","#FFEDD5"];
  const shapes = ["r","o","r","c","r","o","r","r","c","r","o","r"];
  const marks = ["A 12","ニプロ","SW 20","t 1","TYP","KH 603","FE","GS 13","トーワ 5","NY 333","AA 017","Tw 141"];
  let out = "";
  for (let i = 0; i < 24; i++) { const k = (i + seedOff) % 12; const sh = shapes[k];
    const w = sh === "r" ? 120 : sh === "o" ? 190 : 210, h = sh === "r" ? 120 : 100;
    out += `<div class="tab ${sh}" style="width:${w}px; height:${h}px; background:${colors[k]}">${marks[k]}</div>`; }
  return `<div class="a row" style="top:${y}px; animation-duration:${speed}s">${out}</div>`;
}
const VARIETY_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  ${BASE_CSS}
  body { background: #0B1220; color: #F8FAFC; }
  .row { position: absolute; left: 0; display: flex; gap: 40px; white-space: nowrap; animation: scroll linear infinite; --d: 0; }
  @keyframes scroll { from { transform: translateX(0); } to { transform: translateX(-3840px); } }
  .tab { flex: none; display: flex; align-items: center; justify-content: center; font: 700 30px ui-monospace, monospace; color: #475569; box-shadow: 0 14px 30px rgba(0,0,0,.45); }
  .tab.r { border-radius: 50%; } .tab.o { border-radius: 50%; } .tab.c { border-radius: 60px; }
  .cap { position: absolute; left: 0; right: 0; top: 440px; text-align: center; font-size: 72px; font-weight: 700; text-shadow: 0 6px 30px rgba(0,0,0,.8); animation: slideIn .8s ease-out both; --d: 1.2; }
  .sub { position: absolute; left: 0; right: 0; top: 560px; text-align: center; font-size: 46px; color: #CBD5E1; text-shadow: 0 6px 30px rgba(0,0,0,.8); animation: slideIn .8s ease-out both; --d: 2.4; }
  @keyframes slideIn { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
  .shade { position: absolute; left: 0; right: 0; top: 400px; height: 280px; background: rgba(11,18,32,.55); }
</style></head><body>
  ${varietyRow(90, 28, 0)}${varietyRow(260, 36, 5)}${varietyRow(700, 32, 8)}${varietyRow(880, 40, 3)}
  <div class="shade"></div>
  <div class="a cap">同じ成分、違う見た目</div>
  <div class="a sub">ジェネリックは数量の8割以上。1つの成分に、何社もの錠剤がある</div>
</body></html>`;

/** Claude の3場面：カードが順に出て、それぞれ小さな動き */
const CLAUDE3_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  ${BASE_CSS}
  body { background: #F8FAFC; color: #1E293B; }
  .h { position: absolute; left: 0; right: 0; top: 90px; text-align: center; font-size: 64px; font-weight: 700; animation: slideIn .6s ease-out both; --d: 0; }
  .card { position: absolute; top: 260px; width: 520px; height: 560px; background: #fff; border: 4px solid #CBD5E1; border-radius: 28px; padding: 30px; animation: cardIn .7s cubic-bezier(.2,1.2,.4,1) both; box-shadow: 0 16px 40px rgba(0,0,0,.08); }
  @keyframes cardIn { from { opacity: 0; transform: translateY(80px) scale(.9); } to { opacity: 1; transform: translateY(0) scale(1); } }
  .n { font-size: 44px; font-weight: 700; color: #B45309; }
  .t { font-size: 34px; font-weight: 700; line-height: 1.3; margin: 6px 0 18px; white-space: nowrap; }
  .ill { position: relative; height: 300px; }
  .doc { position: absolute; left: 20px; top: 20px; width: 150px; height: 200px; background: #fff; border: 3px solid #94A3B8; border-radius: 8px; }
  .doc i { position: absolute; left: 14px; right: 14px; height: 8px; background: #CBD5E1; border-radius: 4px; }
  .arrow { position: absolute; left: 190px; top: 100px; font-size: 54px; color: #B45309; animation: pulse 1.2s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { transform: translateX(0); } 50% { transform: translateX(12px); } }
  .table { position: absolute; left: 270px; top: 30px; width: 200px; }
  .table i { display: block; height: 30px; margin-bottom: 8px; border-radius: 6px; background: #E2E8F0; animation: fill .4s ease-out both; }
  @keyframes fill { from { width: 0; } to { width: 100%; } }
  .table i.k { background: #FDE68A; }
  .photo { position: absolute; left: 20px; top: 20px; width: 150px; height: 200px; background: #E2E8F0; border: 3px solid #94A3B8; border-radius: 8px; overflow: hidden; }
  .photo i { position: absolute; left: 12px; right: 12px; height: 10px; background: #94A3B8; border-radius: 3px; }
  .term { position: absolute; left: 20px; right: 20px; top: 20px; height: 250px; background: #0F172A; border-radius: 12px; padding: 18px; font: 700 20px ui-monospace, monospace; color: #A7F3D0; overflow: hidden; }
  .term div { white-space: nowrap; overflow: hidden; width: 0; animation: type .9s steps(30) both; }
  @keyframes type { to { width: 100%; } }
  .note { position: absolute; left: 0; right: 0; top: 880px; text-align: center; font-size: 46px; font-weight: 700; color: #475569; animation: slideIn .6s ease-out both; --d: 6.4; }
  @keyframes slideIn { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
</style></head><body>
  <div class="a h">Claude は、三つの場面で</div>
  <div class="a card" style="left:140px; --d:0.6"><div class="n">1</div><div class="t">添付文書 → 外観マスタ</div>
    <div class="ill"><div class="doc"><i style="top:20px"></i><i style="top:40px"></i><i style="top:60px; width:60%"></i><i style="top:100px"></i><i style="top:120px"></i></div><div class="arrow">→</div>
    <div class="table"><i class="a" style="--d:1.4"></i><i class="a k" style="--d:1.6"></i><i class="a" style="--d:1.8"></i><i class="a" style="--d:2.0"></i><i class="a k" style="--d:2.2"></i><i class="a" style="--d:2.4"></i></div></div></div>
  <div class="a card" style="left:700px; --d:2.6"><div class="n">2</div><div class="t">処方箋の写真 → 表</div>
    <div class="ill"><div class="photo"><i style="top:24px"></i><i style="top:60px; width:70%"></i><i style="top:96px"></i><i style="top:132px; width:50%"></i><i style="top:168px"></i></div><div class="arrow">→</div>
    <div class="table"><i class="a" style="--d:3.4"></i><i class="a" style="--d:3.6"></i><i class="a" style="--d:3.8"></i><i class="a" style="--d:4.0"></i><i class="a" style="--d:4.2"></i><i class="a" style="--d:4.4"></i></div></div></div>
  <div class="a card" style="left:1260px; --d:4.6"><div class="n">3</div><div class="t">開発そのものを<br>Claude Code で</div>
    <div class="ill"><div class="term"><div class="a" style="--d:5.2">$ npm run fetch-pdfs</div><div class="a" style="--d:5.6">✓ PMDA から 25 文書を取得</div><div class="a" style="--d:6.0">$ npm run extract -- ...</div><div class="a" style="--d:6.4">✓ data/drafts/... を書き出し</div><div class="a" style="--d:6.8">$ git commit -m "data: ..."</div></div></div></div>
  <div class="a note">推測で埋めず、読めなければ「未確認」。どれも人が確認してから使う</div>
</body></html>`;

/** 広がる：自分の職場（28個の錠剤）から、薬局・病院がぽつぽつ現れ、線でつながって広がる */
const SITES = [[300,420],[520,760],[760,300],[1120,220],[1380,380],[1600,640],[1250,760],[900,800],[1700,220],[420,220],[1500,780],[200,700]];
function sites() {
  return SITES.map(([x,y],i) => `<div class="a site ${i % 3 === 0 ? "hosp" : ""}" style="left:${x}px; top:${y}px; --d:${(2.4 + i * 0.45).toFixed(2)}"><i></i></div>`).join("");
}
function links() {
  const [cx, cy] = [960, 540];
  return SITES.map(([x,y],i) => { const len = Math.hypot(x + 40 - cx, y + 40 - cy).toFixed(0);
    return `<line class="a" x1="${cx}" y1="${cy}" x2="${x + 40}" y2="${y + 40}" style="stroke-dasharray:${len}; stroke-dashoffset:${len}; --d:${(2.1 + i * 0.45).toFixed(2)}"/>`; }).join("");
}
const SPREAD_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  ${BASE_CSS}
  body { background: #0B1220; color: #F8FAFC; }
  .home { position: absolute; left: 860px; top: 440px; width: 200px; height: 200px; border-radius: 24px; background: #1E293B; border: 4px solid #FBBF24; display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; padding: 18px; animation: pop .6s cubic-bezier(.2,1.4,.4,1) both; --d: .2; box-shadow: 0 0 60px rgba(251,191,36,.35); }
  .home i { width: 16px; height: 16px; border-radius: 50%; background: #ECEDE8; animation: pop .3s ease-out both; }
  .homeLabel { position: absolute; left: 0; right: 0; top: 660px; text-align: center; font-size: 36px; font-weight: 700; color: #FBBF24; animation: slideIn .6s ease-out both; --d: 1.2; }
  svg.lines { position: absolute; inset: 0; width: 1920px; height: 1080px; }
  svg.lines line { stroke: #FBBF24; stroke-width: 3; opacity: .7; animation: draw .7s ease-out both; }
  @keyframes draw { to { stroke-dashoffset: 0; } }
  .site { position: absolute; width: 80px; height: 80px; border-radius: 16px; background: #fff; animation: pop .5s cubic-bezier(.2,1.5,.4,1) both; box-shadow: 0 10px 30px rgba(0,0,0,.4); }
  .site::before { content: ""; position: absolute; left: 14px; right: 14px; top: 14px; height: 22px; background: #16A34A; border-radius: 6px; }
  .site::after { content: ""; position: absolute; left: 30px; top: 44px; width: 20px; height: 28px; background: #CBD5E1; border-radius: 4px 4px 0 0; }
  .site.hosp::before { background: #DC2626; }
  .site.hosp i { position: absolute; left: 32px; top: 18px; width: 16px; height: 14px; background: #fff; }
  .site.hosp i::before { content: ""; position: absolute; left: 6px; top: -4px; width: 4px; height: 22px; background: #fff; }
  @keyframes pop { from { opacity: 0; transform: scale(0); } to { opacity: 1; transform: scale(1); } }
  .cap { position: absolute; left: 0; right: 0; top: 100px; text-align: center; font-size: 64px; font-weight: 700; }
  .sub { position: absolute; left: 0; right: 0; top: 920px; text-align: center; font-size: 40px; color: #CBD5E1; animation: slideIn .7s ease-out both; --d: 6.2; }
  @keyframes slideIn { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
</style></head><body>
  <div class="a cap" style="animation: slideIn .7s ease-out both, fadeOut .5s ease-in both; animation-delay: calc((0 - var(--t)) * 1s), calc((3.0 - var(--t)) * 1s) !important;">まず、自分の職場の採用医薬品から</div>
  <div class="a cap" style="animation: slideIn .7s ease-out both; --d: 3.6;">同じ手順で、様々な施設の採用医薬品に広げていける</div>
  <svg class="lines" viewBox="0 0 1920 1080">${links()}</svg>
  ${sites()}
  <div class="a home">${Array.from({length:28}).map((_,i)=>`<i class="a" style="--d:${(0.5+i*0.03).toFixed(2)}"></i>`).join("")}</div>
  <div class="a homeLabel">自分の職場から（デモ処方の28品目は、すべて確認ずみ）</div>
  <div class="a sub">親マスタ（添付文書→外観）＋ 施設ごとの運用マスタ（採用品・一包化区分・分包方法）</div>
</body></html>`;



/** なぜカメラで判定しないのか：左「カメラ→判定」✗、右「処方箋→予想の図→薬剤師が判定」✓ */
const WHY_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  ${BASE_CSS}
  body { background: #F8FAFC; color: #1E293B; }
  .h { position: absolute; left: 0; right: 0; top: 80px; text-align: center; font-size: 60px; font-weight: 700; animation: slideIn .6s ease-out both; --d: 0; }
  .col { position: absolute; top: 220px; width: 800px; height: 700px; border-radius: 28px; padding: 36px; animation: cardIn .7s cubic-bezier(.2,1.2,.4,1) both; }
  .left { left: 120px; background: #fff; border: 4px solid #CBD5E1; --d: 1.2; }
  .right { left: 1000px; background: #fff; border: 4px solid #B45309; --d: 13.6; box-shadow: 0 16px 40px rgba(180,83,9,.15); }
  @keyframes cardIn { from { opacity: 0; transform: translateY(60px); } to { opacity: 1; transform: translateY(0); } }
  .ct { font-size: 44px; font-weight: 700; margin-bottom: 20px; }
  .left .ct { color: #64748B; } .right .ct { color: #B45309; }
  .cam { position: absolute; left: 60px; top: 130px; width: 150px; height: 100px; background: #334155; border-radius: 16px; }
  .cam::before { content: ""; position: absolute; left: 50px; top: 20px; width: 60px; height: 60px; border-radius: 50%; background: #0F172A; border: 8px solid #94A3B8; }
  .cam::after { content: ""; position: absolute; left: 20px; top: -16px; width: 50px; height: 20px; background: #334155; border-radius: 6px 6px 0 0; }
  .beam { position: absolute; left: 210px; top: 150px; width: 0; height: 60px; background: linear-gradient(90deg, rgba(251,191,36,.6), rgba(251,191,36,0)); animation: beam .8s ease-out both; --d: 3.0; }
  @keyframes beam { to { width: 420px; } }
  .pill { position: absolute; width: 110px; height: 110px; border-radius: 50%; perspective: 600px; }
  .pill .flip { width: 100%; height: 100%; position: relative; transform-style: preserve-3d; animation: flip .9s ease-in-out both; }
  .pill .face { position: absolute; inset: 0; border-radius: 50%; backface-visibility: hidden; background: radial-gradient(circle at 35% 30%, #fff 0%, #ECEDE8 60%, #CFD2CA 100%); box-shadow: 0 10px 20px rgba(0,0,0,.2); display: flex; align-items: center; justify-content: center; font: 700 26px ui-monospace, monospace; color: #475569; }
  .pill .back { transform: rotateY(180deg); }
  @keyframes flip { from { transform: rotateY(0); } to { transform: rotateY(180deg); } }
  .tag { position: absolute; padding: 6px 16px; border-radius: 999px; background: #FEF3C7; color: #B45309; font-size: 28px; font-weight: 700; border: 3px solid #F59E0B; animation: pop .4s cubic-bezier(.2,1.6,.4,1) both; }
  .reason { position: absolute; left: 36px; right: 36px; font-size: 30px; line-height: 1.4; white-space: nowrap; color: #475569; animation: slideIn .5s ease-out both; }
  .big { position: absolute; right: 40px; bottom: 30px; font-size: 150px; font-weight: 700; line-height: 1; animation: pop .5s cubic-bezier(.2,1.6,.4,1) both; }
  .left .big { color: #DC2626; --d: 12.4; } .right .big { color: #16A34A; --d: 23.2; }
  .rx { position: absolute; left: 40px; top: 120px; width: 150px; height: 200px; background: #fff; border: 3px solid #94A3B8; border-radius: 8px; animation: pop .4s ease-out both; --d: 16.5; }
  .rx i { position: absolute; left: 14px; right: 14px; height: 8px; background: #CBD5E1; border-radius: 4px; }
  .arrow { position: absolute; font-size: 54px; color: #B45309; font-weight: 700; animation: pop .4s ease-out both; }
  .figure { position: absolute; left: 270px; top: 110px; width: 230px; height: 230px; border-radius: 20px; background: #F1F5F9; border: 3px solid #94A3B8; animation: pop .5s cubic-bezier(.2,1.4,.4,1) both; --d: 17.8; }
  .figure b { position: absolute; left: 0; right: 0; top: 8px; text-align: center; font-size: 22px; color: #334155; }
  .figure i { position: absolute; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #fff 0%, #ECEDE8 60%, #CFD2CA 100%); border: 3px solid #B45309; display: flex; align-items: center; justify-content: center; font: 700 16px ui-monospace, monospace; color: #475569; animation: pop .3s ease-out both; }
  .eye { position: absolute; left: 580px; top: 150px; width: 150px; height: 90px; animation: pop .5s cubic-bezier(.2,1.4,.4,1) both; --d: 23.0; }
  @keyframes slideIn { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes pop { from { opacity: 0; transform: scale(.3); } to { opacity: 1; transform: scale(1); } }
</style></head><body>
  <div class="a h">「カメラで読み取ればいいのでは？」</div>
  <div class="a col left">
    <div class="ct">カメラ → 判定</div>
    <div class="cam"></div><div class="a beam"></div>
    <div class="pill" style="left:280px; top:120px"><div class="a flip" style="--d:4.4"><div class="face">GS 13</div><div class="face back"></div></div></div>
    <div class="pill" style="left:420px; top:150px"><div class="a flip" style="--d:4.8"><div class="face">Tw141</div><div class="face back"></div></div></div>
    <div class="pill" style="left:560px; top:120px"><div class="a flip" style="--d:5.2"><div class="face">TYP0.5</div><div class="face back"></div></div></div>
    <div class="a tag" style="left:290px; top:250px; --d:8.2">区別しづらい</div>
    <div class="a tag" style="left:450px; top:300px; --d:8.5">?</div>
    <div class="a tag" style="left:560px; top:250px; --d:8.8">?</div>
    <div class="a reason" style="top:360px; --d:5.6">・裏を向けば、刻印は見えない</div>
    <div class="a reason" style="top:410px; --d:7.0">・撮り方と光で、結果が変わる</div>
    <div class="a reason" style="top:460px; --d:9.4">・同じ色・同じ大きさは、写真では区別しづらい</div>
    <div class="a reason" style="top:510px; --d:11.2">・専用機は大型で高価。使える施設が限られる</div>
    <div class="a big">✗</div>
  </div>
  <div class="a col right">
    <div class="ct">処方箋 → 予想の図 → 薬剤師が判定</div>
    <div class="a rx"><i style="top:24px"></i><i style="top:60px; width:70%"></i><i style="top:96px"></i><i style="top:132px; width:50%"></i><i style="top:168px"></i></div>
    <div class="a arrow" style="left:205px; top:190px; --d:17.3">→</div>
    <div class="a figure"><b>夕食後 10個</b>
      <i style="left:20px; top:50px; width:66px; height:66px; --d:18.4">TYP0.5</i><i style="left:100px; top:50px; width:60px; height:60px; --d:18.7">GS 13</i><i style="left:165px; top:60px; width:54px; height:54px; --d:19.0">Tw141</i>
      <i style="left:30px; top:130px; width:60px; height:60px; border-color:#94A3B8; --d:19.3">FE</i><i style="left:110px; top:135px; width:58px; height:58px; border-color:#94A3B8; background:#F6C68B; --d:19.5"></i>
    </div>
    <div class="a arrow" style="left:515px; top:190px; --d:22.6">→</div>
    <svg class="a eye" viewBox="0 0 150 90"><path d="M5 45 Q75 -15 145 45 Q75 105 5 45 Z" fill="#fff" stroke="#1E293B" stroke-width="6"/><circle cx="75" cy="45" r="22" fill="#1E293B"/><circle cx="83" cy="38" r="7" fill="#fff"/></svg>
    <div class="a reason" style="top:360px; --d:17.0">・袋を読まず「入っているはずの錠剤」を先に示す</div>
    <div class="a reason" style="top:430px; --d:20.0">・刻印・形・色・大きさを、添付文書から</div>
    <div class="a reason" style="top:500px; --d:23.2">・判定するのは、薬剤師の目</div>
    <div class="a big">✓</div>
  </div>
</body></html>`;


/** 締め（短い版）：スマホ → 「どの施設でも…」「経験の差に…」→ タイトル → クレジット。前半（錠剤が袋に・3行）は実写＋字幕に任せる */
const CLOSING_SHORT_HTML = CLOSING_HTML
  .replace('<div class="a group stage">', '<div class="a group stage" style="display:none">')
  .replace('<div class="a words stage">', '<div class="a words stage" style="display:none">')
  .replace("--d: 10.6; overflow: hidden; }", "--d: 0.3; overflow: hidden; }")
  .replace(".l4 { top: 640px; font-size: 54px; color: #E2E8F0; --d: 11.4; }", ".l4 { top: 640px; font-size: 54px; color: #E2E8F0; --d: 0.9; }")
  .replace(".l5 { top: 730px; font-size: 54px; color: #FBBF24; --d: 12.6; }", ".l5 { top: 730px; font-size: 72px; color: #FBBF24; --d: 4.3; animation: popIn .7s cubic-bezier(.2,1.3,.4,1) both; text-shadow: 0 0 40px rgba(251,191,36,.45); }\n  @keyframes popIn { from { opacity: 0; transform: scale(.7); } to { opacity: 1; transform: scale(1); } }")
  .replace(".final { animation: fadeOut .6s ease-in both; --d: 14.8; }", ".final { animation: fadeOut .6s ease-in both; --d: 7.5; }")
  .replace("animation: titleIn 1s cubic-bezier(.2,.9,.3,1) both; --d: 15.2; }", "animation: titleIn 1s cubic-bezier(.2,.9,.3,1) both; --d: 7.9; }")
  .replace("animation: grow .8s ease-out both; --d: 15.9; }", "animation: grow .8s ease-out both; --d: 8.6; }")
  .replace("animation: slideIn .8s ease-out both; --d: 16.6; }", "animation: slideIn .8s ease-out both; --d: 9.2; }");

async function render(page, html, name, seconds) {
  const dir = path.join(OUT, name); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
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
  await serveFonts(page);
  const which = process.argv[2];
  if (!which || which === "intro") await render(page, INTRO_HTML, "intro", 15);
  if (!which || which === "problem") await render(page, PROBLEM_HTML, "problem", 22);
  if (which === "greeting") await render(page, GREETING_HTML, "greeting", 6);
  if (which === "ippouka") await render(page, IPPOUKA_HTML, "ippouka", 15);
  if (which === "firstbag") await render(page, FIRSTBAG_HTML, "firstbag", 11);
  if (which === "closing") await render(page, CLOSING_HTML, "closing", 19);
  if (which === "closing-short") await render(page, CLOSING_SHORT_HTML, "closing-short", 11);
  if (which === "newbie") await render(page, NEWBIE_HTML, "newbie", 6);
  if (which === "variety") await render(page, VARIETY_HTML, "variety", 8);
  if (which === "claude3") await render(page, CLAUDE3_HTML, "claude3", 12);
  if (which === "spread") await render(page, SPREAD_HTML, "spread", 9);
  if (which === "why") await render(page, WHY_HTML, "why", 27);
  if (which === "title") await render(page, TITLE_HTML, "title", 5);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
