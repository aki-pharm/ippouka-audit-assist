/**
 * 架空の処方箋（デモ用サンプル画像）を作る。実在の患者・施設の情報は含まない。
 *   node scripts/make-samples.cjs  → public/samples/rx-*.png
 * 中身は docs/demo/sample-prescriptions.md と一致させる。
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const FONT_DIR = path.resolve("node_modules/@fontsource/noto-sans-jp/files");
// Noto Sans JP を全部読む（japanese サブセットだけだと一部の漢字が別フォントの字体になる）
const FONT_CSS = ["400", "700"]
  .map((w) => fs.readFileSync(path.join(FONT_DIR, "..", `${w}.css`), "utf8").replace(/url\(\.\/files\//g, `url(file://${FONT_DIR}/`))
  .join("\n");
const OUT = path.resolve("public/samples");

// [rp, manualMark, name, usageLines[], amount, unit, days, total]
const PAGES = {
  "rx-a-1": { title: "架空処方 A（1/2）", rows: [
    ["01", false, "ラベプラゾールNa錠10mg「オーハラ」", ["1回1錠（1日 1錠）", "1日1回 朝食後"], "1錠", "28日分", "28錠"],
    ["02", false, "モサプリドクエン酸塩錠5mg「AA」", ["1回1錠（1日 3錠）", "1日3回 毎食後"], "3錠", "28日分", "84錠"],
    ["03", false, "メチコバール錠500μg", ["1回1錠（1日 2錠）", "1日2回 朝夕食後"], "2錠", "28日分", "56錠"],
    ["04", true, "フォリアミン錠5mg", ["1回1錠（1日 1錠）", "1日1回 夕食後"], "1錠", "28日分", "28錠"],
    ["05", false, "アジルサルタン錠20mg「ニプロ」", ["1回1錠（1日 2錠）", "1日2回 朝夕食後"], "2錠", "28日分", "56錠"],
    ["06", false, "ニフェジピンCR錠20mg「サワイ」", ["1回1錠（1日 1錠）", "1日1回 夕食後"], "1錠", "28日分", "28錠"],
  ], footer: "<<<<< 次ページあり >>>>>" },
  "rx-a-2": { title: "架空処方 A（2/2）", rows: [
    ["07", false, "(K)アスパラカリウム錠300mg", ["1-0-2-0-0-0 で投与", "1日2回 朝夕食後"], "3錠", "28日分", "84錠"],
    ["08", false, "ニフェジピンCR錠10mg「サワイ」", ["1回1錠（1日 1錠）", "別包（ヒート包装）", "1日1回 朝食後"], "1錠", "28日分", "28錠"],
  ], footer: "====== All One Dose　以下余白 ======" },
  "rx-b-1": { title: "架空処方 B（1/1）", rows: [
    ["01", true, "シベンゾリンコハク酸塩錠50mg「サワイ」", ["1回2錠（1日 4錠）", "1日2回 朝夕食後"], "4錠", "14日分", "56錠"],
    ["02", false, "【般】アムロジピン錠2.5mg", ["1回1錠（1日 1錠）", "1日1回 夕食後"], "1錠", "14日分", "14錠"],
    ["03", true, "エリキュース錠5mg", ["1回1錠（1日 2錠）", "1日2回 朝夕食後"], "2錠", "14日分", "28錠"],
    ["04", false, "ピタバスタチンCa錠2mg「日医工」", ["1回1錠（1日 1錠）", "1日1回 朝食後"], "1錠", "14日分", "14錠"],
    ["05", false, "カルベジロール錠2.5mg「サワイ」", ["1回2錠（1日 2錠）", "1日1回 朝食後"], "2錠", "14日分", "28錠"],
    ["06", false, "エルデカルシトールカプセル0.75μg「サワイ」", ["1回1Cap（1日 1Cap）", "別包（ヒート包装）", "1日1回 朝食後"], "1Cap", "14日分", "14Cap"],
    ["07", false, "(Ca)アスパラ-CA錠200mg", ["1回2錠（1日 2錠）", "別包（ヒート包装）", "1日1回 朝食後"], "2錠", "14日分", "28錠"],
  ], footer: "====== All One Dose　以下余白 ======" },
  "rx-c-1": { title: "架空処方 C（1/2）", rows: [
    ["01", false, "クロピドグレル錠75mg「トーワ」", ["1回1錠（1日 1錠）", "1日1回 朝食後"], "1錠", "28日分", "28錠"],
    ["02", false, "クエン酸第一鉄Na錠50mg「NIG」", ["1回1錠（1日 2錠）", "1日2回 朝夕食後"], "2錠", "28日分", "56錠"],
    ["03", false, "エンレスト錠200mg", ["1回1錠（1日 1錠）", "1日1回 朝食後"], "1錠", "28日分", "28錠"],
    ["04", false, "ランソプラゾールOD錠15mg「武田テバ」", ["1回1錠（1日 1錠）", "1日1回 朝食後"], "1錠", "28日分", "28錠"],
    ["05", false, "アムロジピンOD錠10mg「武田テバ」", ["1回1錠（1日 1錠）", "1日1回 朝食後"], "1錠", "28日分", "28錠"],
    ["06", false, "リボトリール錠0.5mg", ["1回2錠（1日 2錠）", "1日1回 夕食後"], "2錠", "28日分", "56錠"],
  ], footer: "<<<<< 次ページあり >>>>>" },
  "rx-c-2": { title: "架空処方 C（2/2）", rows: [
    ["07", true, "ダーブロック錠4mg（通院HD患者は院内処方）", ["1回2錠（1日 2錠）", "1日1回 夕食後"], "2錠", "28日分", "56錠"],
    ["08", true, "オルケディア錠4mg", ["1回3錠（1日 3錠）", "1日1回 夕食後"], "3錠", "28日分", "84錠"],
    ["09", true, "ドキサゾシン錠1mg「トーワ」", ["1回1錠（1日 1錠）", "1日1回 夕食後"], "1錠", "28日分", "28錠"],
    ["10", true, "アミティーザカプセル12μg", ["1回1Cap（1日 2Cap）", "1日2回 朝夕食後"], "2Cap", "28日分", "56Cap"],
  ], footer: "====== All One Dose　<span class='green'>アミティーザも含めて一包化</span> ======" },
};

function html(page) {
  const rows = page.rows.map(([rp, mark, name, usage, amt, days, total]) => `
    <tr>
      <td class="rp">${rp}</td>
      <td class="name">
        <div class="n">${mark ? '<span class="mark">コ</span>' : ""}${name}</div>
        ${usage.map((u) => `<div class="u">${u}</div>`).join("")}
      </td>
      <td class="num">${amt}</td>
      <td class="num">${days}</td>
      <td class="num">${total}</td>
    </tr>`).join("");
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
  <style>
    ${FONT_CSS}
    body { margin: 0; width: 1100px; background: #fff; font-family: "Noto Sans JP", sans-serif; color: #111; }
    .wrap { padding: 36px 44px; }
    .head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #333; padding-bottom: 6px; }
    .head h1 { font-size: 26px; margin: 0; }
    .head .note { font-size: 15px; color: #555; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 24px; }
    th { font-size: 16px; font-weight: 400; color: #333; border-bottom: 1px solid #333; padding: 6px 8px; text-align: left; }
    td { vertical-align: top; padding: 14px 8px; border-bottom: 1px dotted #bbb; }
    td.rp { width: 56px; font-size: 20px; }
    td.num { width: 110px; text-align: right; white-space: nowrap; }
    .n { font-weight: 700; }
    .u { padding-left: 2.5em; font-size: 22px; }
    .mark { display: inline-block; border: 2px solid #2b6cd4; color: #2b6cd4; font-size: 16px; line-height: 18px; padding: 0 3px; margin-right: 8px; vertical-align: 3px; }
    .footer { margin-top: 18px; font-size: 22px; letter-spacing: 1px; }
    .green { color: #1b8a3a; }
    .fine { margin-top: 26px; font-size: 13px; color: #777; }
  </style></head><body><div class="wrap">
    <div class="head"><h1>処方内容（薬剤情報）</h1><div class="note">${page.title}　※架空のデモ用データ</div></div>
    <table><thead><tr><th>Rp</th><th>薬品名（用法・投与日数）</th><th style="text-align:right">分量</th><th style="text-align:right">日数</th><th style="text-align:right">全量</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div class="footer">${page.footer}</div>
    <div class="fine">この様式は本作品のデモ用に作成した架空のものです。実在の医療機関・患者とは関係ありません。</div>
  </div></body></html>`;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 1 });
  for (const [name, def] of Object.entries(PAGES)) {
    await page.setContent(html(def), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log("wrote", file);
  }
  await browser.close();
})();
