/**
 * デモ動画の文字スライド（1920×1080 PNG）を作る。Canva にそのまま入れる用。
 *   node scripts/make-slides.cjs  → docs/demo/slides/*.png
 * 文言は docs/demo/storyboard.md に合わせる。病院名・患者情報・他社製品名は入れない。
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const FONT_DIR = path.resolve("node_modules/@fontsource/noto-sans-jp/files");
const OUT = path.resolve("docs/demo/slides");

const CSS = `
  @font-face { font-family: "NotoJP"; src: url("file://${FONT_DIR}/noto-sans-jp-japanese-400-normal.woff2") format("woff2"); font-weight: 400; }
  @font-face { font-family: "NotoJP"; src: url("file://${FONT_DIR}/noto-sans-jp-japanese-700-normal.woff2") format("woff2"); font-weight: 700; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 1920px; height: 1080px; font-family: "NotoJP", sans-serif; color: #1E293B; }
  body { background: #F8FAFC; padding: 110px 140px; display: flex; flex-direction: column; }
  body.dark { background: #0F172A; color: #F8FAFC; }
  .kicker { font-size: 34px; font-weight: 700; color: #B45309; letter-spacing: 0.08em; margin-bottom: 18px; }
  .dark .kicker { color: #FBBF24; }
  h1 { font-size: 78px; font-weight: 700; line-height: 1.25; margin-bottom: 48px; }
  h1.big { font-size: 96px; }
  ul { list-style: none; font-size: 50px; line-height: 1.5; }
  li { padding-left: 64px; position: relative; margin-bottom: 18px; }
  li::before { content: ""; position: absolute; left: 14px; top: 28px; width: 22px; height: 22px; border-radius: 50%; background: #B45309; }
  .dark li::before { background: #FBBF24; }
  .cols { display: flex; gap: 40px; margin-top: 10px; }
  .col { flex: 1; background: #fff; border: 3px solid #CBD5E1; border-radius: 28px; padding: 40px 36px; }
  .col .n { font-size: 44px; font-weight: 700; color: #B45309; margin-bottom: 14px; }
  .col .t { font-size: 42px; font-weight: 700; line-height: 1.35; margin-bottom: 14px; }
  .col .s { font-size: 32px; line-height: 1.45; color: #475569; }
  .note { margin-top: auto; font-size: 34px; color: #475569; }
  .dark .note { color: #CBD5E1; }
  .center { justify-content: center; align-items: center; text-align: center; }
  .center h1 { margin-bottom: 36px; }
  .center p { font-size: 54px; line-height: 1.5; }
  .credit { position: absolute; left: 140px; right: 140px; bottom: 70px; font-size: 30px; color: #94A3B8; display: flex; justify-content: space-between; }
  .ph { color: #B45309; background: #FEF3C7; padding: 0 16px; border-radius: 12px; }
  .footer { position: absolute; right: 140px; bottom: 70px; font-size: 28px; color: #94A3B8; }
`;

const SLIDES = [
  {
    file: "01-opening",
    body: `<body class="dark center">
      <h1 class="big">この1包、<br>処方どおりだと言い切れますか？</h1>
      <p>白い丸い錠剤が3つ。どれが、どの薬か。</p>
    </body>`,
  },
  {
    file: "02-problem",
    body: `<body>
      <div class="kicker">課題</div>
      <h1>病院や薬局の薬剤師が毎日やっている<br>「1包目の監査」</h1>
      <ul>
        <li>30日分なら、朝・昼・夕・寝る前で 120包。いちばん時間がかかるのが1包目</li>
        <li>同じ成分でも、作る会社ごとに見た目が違う</li>
        <li>新人や応援は見慣れない薬ばかり。50代以降は刻印が見えない</li>
        <li>見逃すといちばん危ないのは、似た見た目の違う薬</li>
      </ul>
    </body>`,
  },
  {
    file: "03-solution",
    body: `<body>
      <div class="kicker">作ったもの</div>
      <h1>一包化監査アシスト</h1>
      <ul>
        <li>カメラに錠剤を判定させない</li>
        <li>処方箋から「袋に入るはずの錠剤」を、刻印つきの図で見せる</li>
        <li>判断するのは薬剤師。アプリは調べる手間を減らす道具</li>
      </ul>
      <div class="note">ベテランが頭の中でやっている「答え合わせ」を、そのまま画面に。</div>
    </body>`,
  },
  {
    file: "09-claude",
    body: `<body>
      <div class="kicker">Claude の使い方</div>
      <h1>調べる・書き起こすは Claude、判断は人</h1>
      <div class="cols">
        <div class="col"><div class="n">1</div><div class="t">添付文書PDF → 外観マスタ</div><div class="s">刻印・色・形・大きさを書き写す。推測で埋めず、読めなければ「未確認」。薬剤師が確認</div></div>
        <div class="col"><div class="n">2</div><div class="t">処方箋の写真 → 表</div><div class="s">薬・規格・朝昼夕の錠数を書き起こす。患者情報は出さない。すべて手で直せる</div></div>
        <div class="col"><div class="n">3</div><div class="t">開発そのものを Claude Code で</div><div class="s">クラウド環境で添付文書の取得から確認まで。コミット履歴に過程が残る</div></div>
      </div>
    </body>`,
  },
  {
    file: "11-validation",
    body: `<body class="center">
      <div class="kicker">検証</div>
      <h1>図があれば、気づける</h1>
      <p>誤りを混ぜた袋を、薬に詳しくない人に見てもらった。<br>図を見ながらなら、<span class="ph">○○秒</span>で刻印の違いに気づけた。</p>
      <div class="footer">※ 架空の処方・デモ用の袋で実施</div>
    </body>`,
  },
  {
    file: "12-closing",
    body: `<body class="dark center">
      <h1>判断するのは薬剤師。<br>アプリは、調べる手間を減らす道具。</h1>
      <p>大きな機械はいらない。<br>どの施設でも、どんな場所でも、手元のスマホで。</p>
      <div class="credit"><span>一包化監査アシスト — Built with Claude: Japan 2026</span><span>VOICEVOX:もち子(cv 明日葉よもぎ)</span></div>
    </body>`,
  },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  for (const s of SLIDES) {
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head>${s.body}</html>`, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const file = path.join(OUT, `${s.file}.png`);
    await page.screenshot({ path: file });
    console.log("wrote", path.relative(process.cwd(), file));
  }
  await browser.close();
})();
