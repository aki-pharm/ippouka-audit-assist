/**
 * 処方箋読み取りの採点用テストセット（架空の処方箋 20 件）を作る。実在の患者・施設の情報は含まない。
 *
 *   node scripts/make-rx-testset.cjs              正解 JSON・行の表・画像・印刷用 PDF を全部作る
 *   node scripts/make-rx-testset.cjs --no-render  正解 JSON と行の表だけ（ブラウザ不要）
 *
 * 入力：data/rx-testset/prescriptions.json（書き方はファイル先頭の _説明）
 * 出力：
 *   data/rx-testset/expected/rxNN.expected.json  正解。/api/read-rx が返す result と同じ形（lib/types.ts の RxReadResultSchema）
 *   data/rx-testset/rows.csv                      1 行＝処方の 1 行。狙い（tricks）・ページ・実在の製品名
 *   data/rx-testset/images/rxNN-P.png             画像（P はページ番号。1100×1556px＝A4 の縦横比）
 *   data/rx-testset/print/rx-testset-print.pdf    印刷用。A4 1 ページに画像 1 枚、rx01 から順に
 *   data/rx-testset/print/print-order.txt         印刷の順番（PNG を個別に印刷するとき用）
 *
 * 見た目は scripts/make-samples.cjs（デモの架空処方箋）と同じ様式。
 * 画像を作るには playwright（npm install で入る）。無ければ環境変数 PLAYWRIGHT_MODULE に playwright の場所、
 * CHROME_PATH に Chrome の実行ファイルを指定できる。@fontsource/noto-sans-jp が無ければ OS の Noto Sans CJK JP を使う。
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "data/rx-testset/prescriptions.json");
const OUT = path.join(ROOT, "data/rx-testset");
const PAGE_W = 1100;
const PAGE_H = 1556;

// ---------- 用法の解釈 ----------
const TIMING_TEXT = { M: "朝食後", N: "昼食後", E: "夕食後", HS: "就寝前" };

/** 時点の組み合わせ → 「朝夕食後」「毎食後」「朝夕食後・就寝前」など */
function timingText(meals, bedtime) {
  let t = "";
  if (meals.length === 3) t = "毎食後";
  else if (meals.length) t = meals.map((m) => ({ M: "朝", N: "昼", E: "夕" })[m]).join("") + "食後";
  if (bedtime) t = t ? `${t}・就寝前` : "就寝前";
  return t;
}

/** u（"1 ME" / "2 HS" / "p:1-0-2-0-0-0"）→ 正解の数と印字する文言 */
function parseUsage(u, unit) {
  if (u.startsWith("p:")) {
    const pattern = u.slice(2);
    const nums = pattern.split("-").map(Number);
    if (nums.length !== 6 || nums.some((n) => !Number.isInteger(n) || n < 0)) throw new Error(`用法の形が違う: ${u}`);
    const meals = ["M", "N", "E"].filter((_, i) => nums[i] > 0);
    const bedtime = nums[3] > 0;
    const times = nums.filter((n) => n > 0).length;
    const perDay = nums.reduce((a, b) => a + b, 0);
    return {
      dose_per_time: null,
      times_per_day: times,
      dose_per_day: perDay,
      per_timing: { morning: nums[0], noon: nums[1], evening: nums[2] },
      line1: `${pattern} で投与`,
      line2: `1日${times}回 ${timingText(meals, bedtime)}`,
      nonuniform: true,
      bedtime,
      maxPerTime: Math.max(...nums),
    };
  }
  const m = u.match(/^(\d+) ([A-Z+]+)$/);
  if (!m) throw new Error(`用法の形が違う: ${u}`);
  const per = Number(m[1]);
  const codes = m[2].split("+");
  const meals = [];
  let bedtime = false;
  for (const c of codes) {
    if (c === "HS") bedtime = true;
    else for (const ch of c) {
      if (!"MNE".includes(ch)) throw new Error(`時点の記号が違う: ${u}`);
      meals.push(ch);
    }
  }
  meals.sort((a, b) => "MNE".indexOf(a) - "MNE".indexOf(b));
  const times = meals.length + (bedtime ? 1 : 0);
  const perDay = per * times;
  return {
    dose_per_time: per,
    times_per_day: times,
    dose_per_day: perDay,
    per_timing: { morning: meals.includes("M") ? per : 0, noon: meals.includes("N") ? per : 0, evening: meals.includes("E") ? per : 0 },
    line1: `1回${per}${unit}（1日 ${perDay}${unit}）`,
    line2: `1日${times}回 ${timingText(meals, bedtime)}`,
    nonuniform: false,
    bedtime,
    maxPerTime: per,
  };
}

// ---------- 薬品名 ----------
const PREFIX_RE = /^(\((?:K|Ca|Na)\))/;
const strip = (name) => name.replace(PREFIX_RE, "");
const isGeneral = (name) => name.startsWith("【般】");

/** 規格：名前の中の「数字＋単位」（mg・μg・mEq）。配合錠など数字が無ければ null */
function strengthOf(name) {
  const m = name.normalize("NFKC").match(/(\d+(?:\.\d+)?)(mg|μg|µg|mEq|g)/);
  return m ? `${m[1]}${m[2].replace("µ", "μ")}` : null;
}

function loadProductNames() {
  const names = new Set();
  for (const t of JSON.parse(fs.readFileSync(path.join(ROOT, "data/master.json"), "utf8"))) names.add(t.brand_name);
  // 親マスタ（main にある）。メーカー選択の索引（feature/maker-select）があればそれも読む。中身は同じ親マスタ由来
  const parent = JSON.parse(fs.readFileSync(path.join(ROOT, "data/parent/parent-master.json"), "utf8"));
  for (const p of parent.products) names.add(p.brand_name);
  const idxFile = path.join(ROOT, "data/parent/maker-index.json");
  if (fs.existsSync(idxFile)) {
    const idx = JSON.parse(fs.readFileSync(idxFile, "utf8"));
    for (const d of Object.values(idx.drugs)) for (const p of d.products) names.add(p.brand_name);
  }
  return names;
}

const isOddDays = (d) => d % 7 !== 0 && d !== 30;

// ---------- 組み立て ----------
function build(def, names) {
  const items = [];
  const meta = [];
  const pages = [];
  let n = 0;
  def.pages.forEach((pageRows, pi) => {
    const shown = [];
    for (const r of pageRows) {
      n += 1;
      const rp = String(n).padStart(2, "0");
      const capsule = r.name.includes("カプセル");
      const unit = capsule ? "Cap" : "錠";
      const us = parseUsage(r.u, unit);
      const days = r.days ?? def.days;
      const product = r.product ?? strip(r.name);
      if (isGeneral(r.name) && !r.product) throw new Error(`${def.id} Rp${rp}: 【般】の行は product が必要`);
      if (!names.has(product)) throw new Error(`${def.id} Rp${rp}: 製品名がマスタ・索引に無い: ${product}`);

      const tricks = new Set(r.tricks ?? []);
      if (r.mark) tricks.add("manual_mark");
      if (r.sep) tricks.add("separate_pack");
      if (us.nonuniform) tricks.add("nonuniform_dosing");
      if (isGeneral(r.name)) tricks.add("general_name");
      if (PREFIX_RE.test(r.name)) tricks.add("prefix");
      if (us.maxPerTime >= 2) tricks.add("two_per_dose");
      if (isOddDays(days)) tricks.add("odd_days");
      if (pi >= 1) tricks.add("page2");
      if (r.note) tricks.add("name_note");
      if (capsule) tricks.add("capsule");
      if (us.bedtime) tricks.add("bedtime");

      const usageLines = [us.line1, ...(r.sep ? ["別包（ヒート包装）"] : []), us.line2];
      items.push({
        rp,
        name_as_written: r.name,
        name_note: r.note ?? null,
        strength: strengthOf(r.name),
        dosage_form: capsule ? "capsule" : "tablet",
        dose_per_time: us.dose_per_time,
        times_per_day: us.times_per_day,
        dose_per_day: us.dose_per_day,
        per_timing: us.per_timing,
        days,
        raw_usage_text: usageLines.join(" ").replace(/（1日 /g, "（1日"),
        pack_instruction: r.sep ? "exclude" : "none",
        manual_fill_mark: !!r.mark,
        confidence: "high",
      });
      meta.push({ rx: def.id, rp, page: pi + 1, name: r.name, product, total: us.dose_per_day * days, tricks: [...tricks].sort() });
      shown.push({
        rp,
        mark: !!r.mark,
        name: r.name + (r.note ? `（${r.note}）` : ""),
        usage: usageLines,
        amount: `${us.dose_per_day}${unit}`,
        days: `${days}日分`,
        total: `${us.dose_per_day * days}${unit}`,
      });
    }
    const last = pi === def.pages.length - 1;
    const no = def.id.replace(/^rx/, "");
    let footer = "<<<<< 次ページあり >>>>>";
    if (last) {
      footer = def.footer === "plain" ? "====== 以下余白 ======" : "====== All One Dose　以下余白 ======";
      if (def.include_all_note) footer = `====== All One Dose　<span class='green'>${def.include_all_note}</span> ======`;
    }
    pages.push({ file: `${def.id}-${pi + 1}`, title: `架空処方 ${no}（${pi + 1}/${def.pages.length}）`, rows: shown, footer });
  });
  const expected = {
    items,
    all_one_dose: def.footer !== "plain",
    include_all_note: def.include_all_note ?? null,
    notes: null,
  };
  return { expected, meta, pages };
}

// ---------- HTML（make-samples.cjs と同じ様式） ----------
function fontCss() {
  const dir = path.join(ROOT, "node_modules/@fontsource/noto-sans-jp");
  if (fs.existsSync(dir)) {
    return {
      css: ["400", "700"].map((w) => fs.readFileSync(path.join(dir, `${w}.css`), "utf8").replace(/url\(\.\/files\//g, "url(http://fonts.local/files/")).join("\n"),
      family: '"Noto Sans JP"',
      dir,
    };
  }
  return { css: "", family: '"Noto Sans CJK JP", "Noto Sans JP", sans-serif', dir: null };
}

function html(page, font) {
  const rows = page.rows.map((r) => `
    <tr>
      <td class="rp">${r.rp}</td>
      <td class="name">
        <div class="n">${r.mark ? '<span class="mark">コ</span>' : ""}${r.name}</div>
        ${r.usage.map((u) => `<div class="u">${u}</div>`).join("")}
      </td>
      <td class="num">${r.amount}</td>
      <td class="num">${r.days}</td>
      <td class="num">${r.total}</td>
    </tr>`).join("");
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
  <style>
    ${font.css}
    html, body { margin: 0; }
    body { width: ${PAGE_W}px; height: ${PAGE_H}px; overflow: hidden; background: #fff; font-family: ${font.family}; color: #111; }
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
  </style></head><body><div class="wrap" id="wrap">
    <div class="head"><h1>処方内容（薬剤情報）</h1><div class="note">${page.title}　※架空のテスト用データ</div></div>
    <table><thead><tr><th>Rp</th><th>薬品名（用法・投与日数）</th><th style="text-align:right">分量</th><th style="text-align:right">日数</th><th style="text-align:right">全量</th></tr></thead>
    <tbody>${page.rows.length ? rows : ""}</tbody></table>
    <div class="footer">${page.footer}</div>
    <div class="fine">この様式は本作品の読み取りテスト用に作成した架空のものです。実在の医療機関・患者とは関係ありません。</div>
  </div></body></html>`;
}

function loadPlaywright() {
  const tries = [process.env.PLAYWRIGHT_MODULE, "playwright"].filter(Boolean);
  for (const t of tries) {
    try { return require(t); } catch { /* 次を試す */ }
  }
  throw new Error("playwright が見つからない。npm install するか、PLAYWRIGHT_MODULE に playwright の場所を指定する");
}

async function render(allPages) {
  const { chromium } = loadPlaywright();
  const font = fontCss();
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const page = await browser.newPage({ viewport: { width: PAGE_W, height: PAGE_H }, deviceScaleFactor: 1 });
  if (font.dir) {
    await page.route("http://fonts.local/**", (route) => {
      const rel = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\//, ""));
      const file = path.join(font.dir, rel);
      if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: "" });
      route.fulfill({ status: 200, contentType: file.endsWith(".woff2") ? "font/woff2" : "font/woff", body: fs.readFileSync(file) });
    });
  }
  const imgDir = path.join(OUT, "images");
  fs.mkdirSync(imgDir, { recursive: true });
  const files = [];
  for (const p of allPages) {
    await page.setContent(html(p, font), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    // A4 1 枚に収まるか（はみ出したら止める）。行の折り返しも確かめる
    const h = await page.evaluate(() => document.getElementById("wrap").scrollHeight);
    if (h > PAGE_H) throw new Error(`${p.file}: 1 ページに収まらない（高さ ${h}px > ${PAGE_H}px）`);
    const wrapped = await page.evaluate(() => [...document.querySelectorAll(".n")].filter((e) => e.getClientRects().length > 1 || e.offsetHeight > 40).map((e) => e.textContent));
    if (wrapped.length) console.warn(`  注意 ${p.file}: 薬品名が折り返している: ${wrapped.join(" / ")}`);
    const file = path.join(imgDir, `${p.file}.png`);
    await page.screenshot({ path: file, fullPage: false });
    files.push(file);
    console.log(`  ${path.relative(ROOT, file)}（内容の高さ ${h}px）`);
  }
  // 印刷用 PDF：画像をそのまま A4 1 ページに 1 枚（写真と画像が同じ見た目になるように）
  const printDir = path.join(OUT, "print");
  fs.mkdirSync(printDir, { recursive: true });
  const imgs = files.map((f) => `<div class="pg"><img src="data:image/png;base64,${fs.readFileSync(f).toString("base64")}"></div>`).join("");
  await page.setContent(`<!doctype html><html><head><style>
    @page { size: A4; margin: 8mm; }
    html, body { margin: 0; }
    .pg { width: 194mm; height: 280mm; page-break-after: always; display: flex; justify-content: center; }
    .pg:last-child { page-break-after: auto; }
    img { width: 194mm; height: auto; }
  </style></head><body>${imgs}</body></html>`, { waitUntil: "load" });
  const pdf = path.join(printDir, "rx-testset-print.pdf");
  await page.pdf({ path: pdf, format: "A4", printBackground: true, margin: { top: "8mm", bottom: "8mm", left: "8mm", right: "8mm" } });
  console.log(`  ${path.relative(ROOT, pdf)}（${files.length} ページ）`);
  await browser.close();
}

const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

(async () => {
  const src = JSON.parse(fs.readFileSync(SRC, "utf8"));
  const names = loadProductNames();
  const expDir = path.join(OUT, "expected");
  fs.mkdirSync(expDir, { recursive: true });
  const allPages = [];
  const metaRows = [];
  const ids = new Set();
  for (const def of src.prescriptions) {
    if (ids.has(def.id)) throw new Error(`id が重複: ${def.id}`);
    ids.add(def.id);
    const { expected, meta, pages } = build(def, names);
    fs.writeFileSync(path.join(expDir, `${def.id}.expected.json`), JSON.stringify(expected, null, 1) + "\n");
    metaRows.push(...meta);
    allPages.push(...pages);
  }
  const header = ["rx", "rp", "page", "name_as_written", "product", "total", "tricks"];
  const lines = [header.join(","), ...metaRows.map((m) => [m.rx, m.rp, m.page, m.name, m.product, m.total, m.tricks.join(" ")].map(csvCell).join(","))];
  fs.writeFileSync(path.join(OUT, "rows.csv"), lines.join("\n") + "\n");
  const printDir = path.join(OUT, "print");
  fs.mkdirSync(printDir, { recursive: true });
  fs.writeFileSync(path.join(printDir, "print-order.txt"), allPages.map((p, i) => `${String(i + 1).padStart(2, " ")}  images/${p.file}.png  ${p.title}`).join("\n") + "\n");

  // 狙いごとの行数
  const count = {};
  for (const m of metaRows) for (const t of m.tricks) count[t] = (count[t] ?? 0) + 1;
  console.log(`処方 ${src.prescriptions.length} 件・行 ${metaRows.length}・ページ ${allPages.length}`);
  console.log("狙いごとの行数:", Object.entries(count).sort().map(([k, v]) => `${k} ${v}`).join("、"));

  if (process.argv.includes("--no-render")) return;
  await render(allPages);
})().catch((e) => {
  console.error("失敗:", e.message);
  process.exit(1);
});
