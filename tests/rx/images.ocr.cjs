// 画像・印刷用 PDF の中身が prescriptions.json の定義と合うか（OCR）。npm run test:rx でだけ動く（2 分ほどかかる）。
// - 画像：tesseract（jpn）で行ごとに読み、Rp・薬品名・分量・日数・全量・用法・別包・□コ（青）・フッター・緑字を見る
// - PDF：文字の層が無い（画像を貼っただけ）ので、文字の抽出はできない。pdfimages で取り出した画像が PNG と同じかを見る
// tesseract（jpn）・pdfimages・Python の Pillow/numpy が無ければ飛ばす。RX_OCR_JSON に前回の OCR 結果を渡すと使い回す
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DATA, defs, expectedOf, usage } = require("./helpers.cjs");

const has = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" }).status === 0;
const tessOk = has("tesseract", ["--version"]) && /\bjpn\b/.test(spawnSync("tesseract", ["--list-langs"], { encoding: "utf8" }).stdout ?? "");
const pyOk = has("python3", ["-c", "import PIL, numpy"]);

// OCR の読み違いを寄せる：μ→u、0D→OD
const norm = (s) => String(s ?? "").normalize("NFKC").replace(/[\s|]/g, "").replace(/[µμ]/g, "u").replace(/0D/g, "OD");
function dice(a, b) {
  if (a === b) return 1;
  const g = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1); return m; };
  const A = g(a), B = g(b);
  let n = 0;
  for (const [k, v] of A) n += Math.min(v, B.get(k) ?? 0);
  return (2 * n) / Math.max(1, a.length - 1 + b.length - 1);
}
const lead = (s) => { const m = /^\D*?(\d+)/.exec(norm(s)); return m ? Number(m[1]) : NaN; };

function timingWords(slots) {
  const meals = ["朝", "昼", "夕"].filter((_, i) => slots[i] > 0);
  const w = [];
  if (meals.length === 3) w.push("毎食後");
  else if (meals.length) w.push(meals.join("") + "食後");
  if (slots[3]) w.push("就寝前");
  return w;
}

test("画像の文字（OCR）が定義と一致する：Rp・薬品名・分量・日数・全量・用法・別包・□コ・フッター", { skip: !(tessOk && pyOk) && "tesseract(jpn) か Pillow/numpy が無い" }, () => {
  let pages;
  if (process.env.RX_OCR_JSON && fs.existsSync(process.env.RX_OCR_JSON)) pages = JSON.parse(fs.readFileSync(process.env.RX_OCR_JSON, "utf8"));
  else {
    const r = spawnSync("python3", ["-I", path.join(__dirname, "ocr-images.py"), path.join(DATA, "images")], { encoding: "utf8", maxBuffer: 64 << 20 });
    assert.equal(r.status, 0, r.stderr);
    pages = JSON.parse(r.stdout);
    if (process.env.RX_OCR_SAVE) fs.writeFileSync(process.env.RX_OCR_SAVE, r.stdout);
  }
  const byFile = new Map(pages.map((p) => [p.file, p]));
  const bad = [];
  let checkedRows = 0;
  for (const def of defs()) {
    const exp = expectedOf(def.id);
    let idx = 0;
    def.pages.forEach((rows, pi) => {
      const file = `${def.id}-${pi + 1}.png`;
      const pg = byFile.get(file);
      if (!pg) { bad.push(`${file}: 画像が無い`); return; }
      const last = pi === def.pages.length - 1;
      const want = rows.map((r, k) => ({ r, e: exp.items[idx + k] }));
      idx += rows.length;
      const gotRp = pg.rows.map((x) => x.rp);
      if (gotRp.join(",") !== want.map((w) => w.e.rp).join(",")) bad.push(`${file}: Rp ${gotRp.join(",")} ≠ ${want.map((w) => w.e.rp).join(",")}`);
      // ページ全体
      const text = norm(pg.text + pg.footer);
      // 見出し「架空処方 07（1/2）※架空のテスト用データ」（撮った写真のファイル名をこれに合わせる）
      if (!norm(pg.header).includes(`架空処方${def.id.slice(2)}(${pi + 1}/${def.pages.length})`)) bad.push(`${file}: 見出し「${pg.header}」`);
      if (!norm(pg.header).includes("架空のテスト用データ")) bad.push(`${file}: 見出しに「架空のテスト用データ」が無い`);
      if (!/架空/.test(pg.fine_print + pg.text)) bad.push(`${file}: 「架空」の注記が読めない`);
      if (last) {
        // 「○○も含めて一包化」のある処方（rx12）は、フッターに「以下余白」を書かない様式（生成スクリプトの仕様）
        if (!/余白/.test(text) && !exp.include_all_note) bad.push(`${file}: 最後のページに「以下余白」が無い`);
        if (/OneDose/i.test(text) !== exp.all_one_dose) bad.push(`${file}: All One Dose の有無が all_one_dose=${exp.all_one_dose} と合わない`);
      } else if (!/次ページ/.test(text + norm(pg.rows.at(-1)?.usage))) bad.push(`${file}: 「次ページあり」が無い`);
      const wantGreen = last && !!exp.include_all_note;
      if ((pg.green_px_total > 50) !== wantGreen) bad.push(`${file}: 緑字（含めて一包化）の有無 ${pg.green_px_total}px`);
      if (wantGreen && dice(norm(pg.footer), norm(exp.include_all_note)) < 0.3 && !norm(pg.footer).includes("一包化")) bad.push(`${file}: 緑字の文言`);
      const marks = want.filter((w) => w.e.manual_fill_mark).length;
      if (Math.round(pg.blue_px_total / 217) !== marks) bad.push(`${file}: 青い □コ の数 ${pg.blue_px_total}px ≠ ${marks} 個`);
      // 行
      for (const { r, e } of want) {
        const o = pg.rows.find((x) => x.rp === e.rp);
        if (!o) continue;
        checkedRows++;
        const w = `${file} Rp${e.rp}`;
        const nameWant = norm(e.name_as_written + (e.name_note ? `(${e.name_note})` : ""));
        const sim = dice(norm(o.name), nameWant);
        if (sim < 0.7) bad.push(`${w}: 薬品名 「${o.name}」≠「${e.name_as_written}」(${sim.toFixed(2)})`);
        if (e.strength) {
          // 規格の数字（5mg の 5）。配合錠の記号（HD・A81）はそのまま名前の中に読めること
          const key = e.name_as_written.includes("配合錠") ? e.strength : (e.strength.match(/[\d.]+/) ?? [e.strength])[0];
          if (!norm(o.name).includes(key)) bad.push(`${w}: 規格 ${key} が読めない「${o.name}」`);
        }
        if (/OD/.test(e.name_as_written) !== /OD/.test(norm(o.name))) bad.push(`${w}: OD の有無`);
        if (lead(o.amount) !== e.dose_per_day) bad.push(`${w}: 分量 「${o.amount}」≠ ${e.dose_per_day}`);
        if (lead(o.days) !== e.days) bad.push(`${w}: 日数 「${o.days}」≠ ${e.days}`);
        if (lead(o.total) !== e.dose_per_day * e.days) bad.push(`${w}: 全量 「${o.total}」≠ ${e.dose_per_day * e.days}`);
        const u = norm(o.usage);
        const { per, slots, pattern } = usage(r.u);
        if (per != null) {
          if (!u.includes(`1回${per}`)) bad.push(`${w}: 用法の 1回${per}`);
          if (!u.includes(`1日${e.dose_per_day}`)) bad.push(`${w}: 用法の 1日${e.dose_per_day}`);
        } else if (!u.includes(`${pattern}で投与`)) bad.push(`${w}: 用法の ${pattern} で投与「${o.usage}」`);
        if (!u.includes(`1日${e.times_per_day}回`)) bad.push(`${w}: 用法の 1日${e.times_per_day}回`);
        for (const t of timingWords(slots)) if (!u.includes(t)) bad.push(`${w}: 用法に「${t}」が無い「${o.usage}」`);
        if (/別包/.test(u) !== (e.pack_instruction === "exclude")) bad.push(`${w}: 別包の有無`);
        if ((o.blue_px > 100) !== e.manual_fill_mark) bad.push(`${w}: □コ の有無（青 ${o.blue_px}px）`);
      }
    });
  }
  assert.equal(checkedRows, 145, `OCR で行を見つけられたのは ${checkedRows}/145`);
  assert.deepEqual(bad, []);
});

const pdfOk = has("pdfimages", ["-v"]) && pyOk;
test("印刷用 PDF：A4 24 ページ、文字の層は無い（画像だけ）、各ページの画像が images/ の PNG と同じ順・同じ絵", { skip: !pdfOk && "pdfimages か Pillow が無い" }, () => {
  const pdf = path.join(DATA, "print/rx-testset-print.pdf");
  const info = spawnSync("pdfinfo", [pdf], { encoding: "utf8" }).stdout;
  assert.match(info, /Pages:\s+24/);
  assert.match(info, /A4/);
  // 文字の層：pdffonts が空＝文字は無い（PyMuPDF でも pdftotext でも文字は取り出せない。OCR は PNG で行う）
  const fonts = spawnSync("pdffonts", [pdf], { encoding: "utf8" }).stdout.trim().split("\n");
  assert.equal(fonts.length, 2, "PDF にフォントがある（文字の層がある）なら、文字の比較を足すこと");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rxpdf-"));
  assert.equal(spawnSync("pdfimages", ["-png", pdf, path.join(tmp, "p")]).status, 0);
  const order = fs.readFileSync(path.join(DATA, "print/print-order.txt"), "utf8").trim().split("\n").map((l) => l.trim().split(/\s+/)[1]);
  assert.equal(order.length, 24);
  const py = `
import sys, numpy as np
from PIL import Image
a = np.asarray(Image.open(sys.argv[1]).convert("RGB")).astype(int)
b = np.asarray(Image.open(sys.argv[2]).convert("RGB")).astype(int)
print("same" if a.shape == b.shape and np.abs(a - b).max() <= 8 else f"diff {a.shape} {b.shape}")`;
  const got = fs.readdirSync(tmp).filter((f) => f.endsWith(".png")).sort();
  assert.equal(got.length, 24, "PDF の画像の数");
  const bad = [];
  got.forEach((f, i) => {
    const r = spawnSync("python3", ["-I", "-c", py, path.join(tmp, f), path.join(DATA, order[i])], { encoding: "utf8" });
    if (r.stdout.trim() !== "same") bad.push(`${i + 1} ページ ${order[i]}: ${r.stdout.trim() || r.stderr.slice(0, 200)}`);
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.deepEqual(bad, []);
});
