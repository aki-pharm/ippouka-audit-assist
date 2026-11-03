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
  .pill { position: absolute; width: 38px; height: 32px; border-radius: 50%; box-shadow: 0 6px 12px rgba(0,0,0,.18); animation: fly 1.1s cubic-bezier(.3,.6,.3,1) both; }
  @keyframes fly { 0% { transform: translate(0,0) scale(1); opacity: 1; } 100% { transform: translate(var(--dx), var(--dy)) scale(.9); opacity: 1; } }
  .bag { position: absolute; width: 200px; height: 240px; border-radius: 16px; background: rgba(255,255,255,.75); border: 4px solid #94A3B8; animation: pop .6s cubic-bezier(.2,1.4,.4,1) both; }
  .bag::before { content: ""; position: absolute; left: 14px; right: 14px; top: 14px; height: 10px; border-radius: 5px; background: #CBD5E1; }
  .bag b { position: absolute; left: 0; right: 0; top: 30px; text-align: center; font-size: 34px; font-weight: 900; color: #334155; }
  .bag i { position: absolute; width: 38px; height: 32px; border-radius: 50%; box-shadow: 0 4px 8px rgba(0,0,0,.15); animation: pop .4s ease-out both; }
  @keyframes pop { from { opacity: 0; transform: scale(.4); } to { opacity: 1; transform: scale(1); } }
  .cap { position: absolute; left: 0; right: 0; text-align: center; font-weight: 900; animation: slideIn .7s ease-out both; }
  @keyframes slideIn { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  .s1 { animation: fadeOut .6s ease-in both; --d: 7.2; }
  .s2 { position: absolute; inset: 0; animation: fadeIn .6s ease-out both; --d: 7.6; }
  .person { position: absolute; left: 520px; top: 300px; width: 300px; height: 420px; animation: bob 2.6s ease-in-out infinite; }
  @keyframes bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
  .mouthSad { animation: fadeOut .3s both; --d: 11.4; } .mouthHappy { animation: fadeIn .3s both; --d: 11.4; }
  .sweat { animation: fadeOut .3s both; --d: 11.4; }
  .q { position: absolute; font-size: 90px; font-weight: 900; color: #B45309; animation: pop .5s cubic-bezier(.2,1.6,.4,1) both; }
  .qs { animation: fadeOut .3s both; --d: 11.3; }
  .hand { position: absolute; left: 1250px; top: 420px; animation: hand 1.2s ease-out both; --d: 10.4; }
  @keyframes hand { from { transform: translateX(260px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
  .ok { position: absolute; left: 1310px; top: 290px; font-size: 100px; color: #16A34A; font-weight: 900; animation: pop .5s cubic-bezier(.2,1.6,.4,1) both; --d: 11.6; }
</style></head><body>
<div class="a s1 stage">
  ${ptp(200, 330, "#FDE68A", 0.2)}${ptp(400, 330, "#FFFFFF", 0.4)}${ptp(600, 330, "#F9A8D4", 0.6)}${ptp(800, 330, "#BFDBFE", 0.8)}
  <!-- 各シートから1錠が袋へ飛ぶ -->
  <div class="a pill" style="left:265px; top:460px; background:#FDE68A; --dx:1000px; --dy:-20px; --d:1.6"></div>
  <div class="a pill" style="left:465px; top:460px; background:#FFFFFF; --dx:860px; --dy:30px; --d:1.9"></div>
  <div class="a pill" style="left:665px; top:460px; background:#F9A8D4; --dx:610px; --dy:80px; --d:2.2"></div>
  <div class="a pill" style="left:865px; top:460px; background:#BFDBFE; --dx:460px; --dy:120px; --d:2.5"></div>
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
  .h { position: absolute; left: 150px; top: 120px; font-size: 60px; font-weight: 900; animation: slideIn .6s ease-out both; --d: 0; }
  .bag { position: absolute; width: 64px; height: 48px; border-radius: 8px; background: #fff; border: 3px solid #94A3B8; box-shadow: 0 4px 10px rgba(0,0,0,.08); animation: none; }
  .bag::after { content: ""; position: absolute; left: 10px; right: 10px; top: 12px; height: 6px; background: #CBD5E1; border-radius: 3px; }
  .sweep { position: absolute; top: 280px; width: 160px; height: 400px; background: linear-gradient(90deg, rgba(251,191,36,0) 0%, rgba(251,191,36,.55) 50%, rgba(251,191,36,0) 100%); animation: sweep 2.2s linear both; --d: 0.6; }
  @keyframes sweep { from { left: 60px; } to { left: 1700px; } }
  .rest { animation: dim .8s ease-out both; --d: 3.4; }
  @keyframes dim { to { opacity: .22; } }
  .first { position: absolute; left: 150px; top: 300px; width: 64px; height: 48px; border-radius: 8px; background: #fff; border: 3px solid #B45309; transform-origin: 0 0; animation: grow 1s cubic-bezier(.2,.9,.3,1) both; --d: 3.4; box-shadow: 0 10px 30px rgba(0,0,0,.15); }
  .first::after { content: ""; position: absolute; left: 10px; right: 10px; top: 12px; height: 6px; background: #CBD5E1; border-radius: 3px; }
  @keyframes grow { to { transform: translate(120px, 0) scale(5); } }
  .label { position: absolute; left: 740px; top: 330px; font-size: 64px; font-weight: 900; color: #B45309; animation: slideIn .6s ease-out both; --d: 4.4; }
  .label small { display: block; font-size: 36px; color: #475569; font-weight: 700; margin-top: 10px; }
  .clock { position: absolute; left: 560px; top: 300px; width: 70px; height: 70px; border-radius: 50%; border: 6px solid #B45309; background: #fff; animation: pop .5s cubic-bezier(.2,1.6,.4,1) both; --d: 4.0; }
  .clock::before { content: ""; position: absolute; left: 50%; top: 10px; width: 5px; height: 26px; background: #B45309; transform-origin: 50% 100%; margin-left: -2px; animation: tick 2s linear infinite; }
  @keyframes tick { to { transform: rotate(360deg); } }
  .same { position: absolute; left: 740px; top: 560px; font-size: 40px; font-weight: 700; color: #334155; animation: slideIn .6s ease-out both; --d: 6.2; }
  .checks { position: absolute; left: 740px; top: 640px; display: flex; gap: 14px; }
  .checks i { width: 64px; height: 48px; border-radius: 8px; background: #fff; border: 3px solid #94A3B8; position: relative; animation: pop .35s cubic-bezier(.2,1.6,.4,1) both; }
  .checks i::after { content: "✓"; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #16A34A; font-weight: 900; font-size: 30px; }
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
  .ok { position: absolute; left: 1080px; top: 250px; width: 110px; height: 110px; border-radius: 50%; background: #16A34A; color: #fff; font-size: 80px; font-weight: 900; display: flex; align-items: center; justify-content: center; animation: pop .5s cubic-bezier(.2,1.6,.4,1) both; --d: 2.0; box-shadow: 0 10px 30px rgba(0,0,0,.4); }
  .group { animation: fadeOut .6s ease-in both; --d: 4.2; }
  .line { position: absolute; left: 0; right: 0; text-align: center; font-weight: 900; animation: slideIn .8s cubic-bezier(.2,.9,.3,1) both; }
  .l1 { top: 300px; font-size: 92px; --d: 4.8; }
  .l2 { top: 440px; font-size: 64px; font-weight: 700; color: #CBD5E1; --d: 5.8; }
  .l3 { top: 600px; font-size: 54px; font-weight: 700; color: #FBBF24; --d: 7.0; }
  .words { animation: fadeOut .6s ease-in both; --d: 10.2; }
  .phone { position: absolute; left: 860px; top: 200px; width: 200px; height: 400px; border-radius: 34px; border: 8px solid #E2E8F0; background: #0F172A; animation: phoneIn 1s cubic-bezier(.2,.9,.3,1) both; --d: 10.6; overflow: hidden; }
  .phone i { position: absolute; left: 18px; right: 18px; height: 54px; border-radius: 10px; background: #1E293B; border: 2px solid #334155; }
  .phone b { position: absolute; width: 28px; height: 28px; border-radius: 50%; background: #F1F5F9; }
  @keyframes phoneIn { from { opacity: 0; transform: translateY(60px) scale(.9); } to { opacity: 1; transform: translateY(0) scale(1); } }
  .l4 { top: 640px; font-size: 54px; color: #E2E8F0; --d: 11.4; }
  .title { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; animation: titleIn 1s cubic-bezier(.2,.9,.3,1) both; --d: 14.0; }
  .title h1 { font-size: 140px; font-weight: 900; letter-spacing: .04em; }
  .title .bar { width: 0; height: 10px; background: #FBBF24; margin: 30px 0; animation: grow .8s ease-out both; --d: 14.7; }
  .credit { position: absolute; left: 140px; right: 140px; bottom: 60px; display: flex; justify-content: space-between; font-size: 30px; color: #94A3B8; animation: slideIn .8s ease-out both; --d: 15.4; }
  .final { animation: fadeOut .6s ease-in both; --d: 13.6; }
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
    <div class="a line l4">どの施設でも、どんな場所でも、手元のスマホで。</div>
  </div>
  <div class="a title">
    <h1>一包化監査アシスト</h1>
    <div class="a bar"></div>
  </div>
  <div class="a credit"><span>Built with Claude: Japan 2026</span><span>VOICEVOX:もち子(cv 明日葉よもぎ)</span></div>
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
  if (which === "ippouka") await render(page, IPPOUKA_HTML, "ippouka", 15);
  if (which === "firstbag") await render(page, FIRSTBAG_HTML, "firstbag", 11);
  if (which === "closing") await render(page, CLOSING_HTML, "closing", 18);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
