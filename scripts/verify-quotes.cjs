/**
 * 親マスタの下書きを、添付文書PDFの文字と照らし合わせる。AI は使わない（文字の一致だけ）。
 *   node scripts/verify-quotes.cjs [--model claude-sonnet-5-5] [--selftest]
 *
 * 見ること（品目ごと）
 *   1. 根拠の文言（source_quote）が、そのページの本文にあるか（空白と句読点・括弧の違いは無視する）
 *        一致（全文）   ：文言がそのまま本文に入っている
 *        一致（語）     ：文言を空白や「/」で区切った語が、すべて本文に入っている
 *        一致（組み立て）：本文にある 2 文字以上の断片をつなぐと、文言の 95% 以上が組み立てられ、残りはどれも 1 文字まで
 *                         （表の見出しとマスをつないで書き起こした文言はここになる。例：表の「直径」「約14mm」→「直径約14mm」）
 *        近似（要目視） ：80% 以上が組み立てられるが、本文に見つからない 2 文字以上のまとまりがある
 *        不一致         ：それ未満。捨てずに一覧に出す
 *        照合不能       ：PDF が無い／文字が取り出せない（画像だけのPDFなど）／下書きが空
 *   2. 抽出した値そのもの（刻印の表・裏、長径、短径、厚さ、色）が、本文にあるか
 *
 * 入力：data/parent/drafts/<model>/*.json、data/parent/pmda-links.json、pdfs/parent/<doc_id>.pdf（コミットしない）
 * 出力：data/parent/verify/quote-check.csv（全品目）、needs-review.csv（目で見るもの。優先度つき）、unable.csv（照合不能）、summary.json
 *
 * 限界：分かるのは「その文字・数字が、そのページにある」ことまで。
 *       ・複数の規格が載る添付文書で、隣の規格の値を取り違えていても見つけられない（どちらもページにあるため）
 *       ・刻印が図（画像）でしか載っていない添付文書では、刻印は「なし」になる（誤りとは限らない）
 *       ・実物の錠剤と合っているかは人が確かめる
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const MODEL = arg("--model", "claude-sonnet-5-5");
const SELFTEST = process.argv.includes("--selftest");
const DRAFTS = path.join("data/parent/drafts", MODEL);
const PDF_DIR = "pdfs/parent";
const TXT_DIR = "pdfs/parent-txt";
const OUT = "data/parent/verify";
fs.mkdirSync(TXT_DIR, { recursive: true });

/** 比べる前にそろえる：全角半角（NFKC）、波線・ハイフンの表記ゆれ */
function unify(s) {
  return String(s ?? "").normalize("NFKC").replace(/[〜∼~]/g, "~").replace(/[‐‑‒–—―−－]/g, "-").replace(/[･・]/g, "・");
}
/** 空白を除く（刻印・色を探すとき） */
const norm = (s) => unify(s).replace(/\s+/g, "");
/** 空白と句読点・括弧も除く（根拠の文言を探すとき）。小数点は残す */
const strip = (s) => norm(s).replace(/[()\[\]{}「」『』｢｣【】<>:;,、。・\/|※~\-*＊'"“”‘’]/g, "");
/** 空白を1つにそろえて残す（数字を探すとき。表の隣のマスの数字とつながらないように） */
const spaced = (s) => unify(s).replace(/\s+/g, " ");

/** PDF → ページごとの本文（並び順どおり／見た目どおりの2通りを取り、両方をつないで探す） */
function pagesOf(docId) {
  const pdf = path.join(PDF_DIR, `${docId}.pdf`);
  if (!fs.existsSync(pdf)) return null;
  const raw = [];
  for (const mode of ["-layout", "-raw"]) {
    const cache = path.join(TXT_DIR, `${docId}${mode}.txt`);
    let txt;
    if (fs.existsSync(cache)) txt = fs.readFileSync(cache, "utf8");
    else {
      try { txt = execFileSync("pdftotext", [mode, pdf, "-"], { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024 }).toString("utf8"); }
      catch { txt = ""; }
      if (txt.trim()) fs.writeFileSync(cache, txt); // 空の結果は残さない（取得途中のPDFを空として覚えないため）
    }
    txt.split("\f").forEach((p, i) => { raw[i] = (raw[i] ?? "") + "\n" + p; });
  }
  return raw.map((t) => ({ norm: norm(t), strip: strip(t), spaced: spaced(t) }));
}

/** 文言を語に割る。1文字だけの語（「剤　形」の片割れなど）は数えない */
function tokensOf(quote) {
  return unify(quote).split(/[\s/|｜]+/).map(strip).filter((t) => t.length >= 2);
}

/** 本文にある2文字以上の断片を前から順につないで、文言のどこまで組み立てられるか。組み立てられなかった所も返す */
function coverage(q, text) {
  let covered = 0; const gaps = []; let gap = "";
  for (let i = 0; i < q.length; ) {
    let len = 0;
    if (i + 2 <= q.length && text.includes(q.slice(i, i + 2))) {
      len = 2;
      while (i + len < q.length && text.includes(q.slice(i, i + len + 1))) len++;
    }
    if (len >= 2) { covered += len; i += len; if (gap) { gaps.push(gap); gap = ""; } }
    else { gap += q[i]; i++; }
  }
  if (gap) gaps.push(gap);
  return { ratio: q.length ? covered / q.length : 0, gaps };
}

function checkQuote(pages, page, quote) {
  const q = strip(quote);
  if (q.length < 4) return { verdict: "不一致", ratio: 0, foundPage: page, missing: ["（文言が短すぎる）"] };
  const order = [page, page + 1, page - 1, page + 2, page - 2].filter((p) => p >= 1 && p <= pages.length);
  for (const p of order) if (pages[p - 1].strip.includes(q)) return { verdict: "一致（全文）", ratio: 1, foundPage: p, missing: [] };
  const toks = tokensOf(quote);
  for (const p of order) if (toks.length && toks.every((t) => pages[p - 1].strip.includes(t))) return { verdict: "一致（語）", ratio: 1, foundPage: p, missing: [] };
  let best = { ratio: -1, foundPage: page, missing: [] };
  for (const p of order) {
    const c = coverage(q, pages[p - 1].strip);
    if (c.ratio > best.ratio) best = { ratio: c.ratio, foundPage: p, missing: c.gaps };
  }
  // 組み立てで「一致」と言えるのは、95% 以上が組み立てられ、かつ組み立てられなかった所がどれも 1 文字まで（「約」「の」など）のとき。
  // 2 文字以上のまとまりが見つからないなら、本文に無い語（刻印など）が混ざっているので、目で見る側に回す
  const longestGap = best.missing.reduce((m, g) => Math.max(m, g.length), 0);
  const verdict = best.ratio >= 0.95 && longestGap <= 1 ? "一致（組み立て）" : best.ratio >= 0.8 ? "近似（要目視）" : "不一致";
  return { verdict, ...best };
}

const SKIP = new Set(["", "なし", "未確認"]);
/**
 * 値（刻印・色）が本文にあるか
 *   "あり"          ：空白を除いた値が、そのまま本文に入っている
 *   "語ごとにあり"  ：値を語に割ると、すべての語が本文に入っている（まとまりとしては見つからない。弱い手がかり）
 *                     社名マーク（ε、Ⓚ など図で描かれる記号）は語に数えない
 *   "なし"          ：見つからない語がある（刻印が図だけに載っている場合もここになる）
 *   "対象外"        ：値が なし・未確認・空
 */
function hasText(text, v) {
  const n = norm(v);
  if (SKIP.has(String(v ?? "").trim()) || !n) return "対象外";
  if (text.includes(n)) return "あり";
  if (text.toLowerCase().includes(n.toLowerCase())) return "あり（大小文字違い）";
  const parts = unify(v).match(/[A-Za-z0-9.]+|[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー]+/gu) ?? [];
  const words = parts.filter((w) => w.length >= 2 || /^\d$/.test(w));
  if (words.length && words.every((w) => text.includes(w))) return "語ごとにあり";
  return "なし";
}
/** 数値が本文にあるか。7 は「7.0」か、前後が数字でない「7」として探す（空白を残した本文で） */
function hasNumber(text, v) {
  if (v === null || v === undefined || v === "") return "対象外";
  const x = Number(v);
  if (!Number.isFinite(x)) return "対象外";
  const forms = new Set([String(x)]);
  if (Number.isInteger(x)) { forms.add(x.toFixed(1)); forms.add(x.toFixed(2)); }
  else if (Number.isInteger(Math.round(x * 10 * 1e6) / 1e6)) forms.add(x.toFixed(2));
  for (const f of forms) {
    const re = new RegExp(`(?<![\\d.])${f.replace(".", "\\.")}(?!\\d|\\.\\d)`);
    if (re.test(text)) return "あり";
  }
  return "なし";
}

function csvCell(v) { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }

function main() {
  const links = JSON.parse(fs.readFileSync("data/parent/pmda-links.json", "utf8"));
  const files = fs.readdirSync(DRAFTS).filter((f) => f.endsWith(".json")).sort();
  const cache = new Map();
  const getPages = (docId) => { if (!cache.has(docId)) cache.set(docId, pagesOf(docId)); return cache.get(docId); };

  const rows = [];
  let emptyDrafts = 0;
  for (const f of files) {
    const d = JSON.parse(fs.readFileSync(path.join(DRAFTS, f), "utf8"));
    const yj = d.id;
    const docId = links[yj]?.doc_id ?? String(d.source_file ?? "").replace(/\.pdf$/, "");
    const products = d.products ?? [];
    if (products.length === 0) {
      emptyDrafts++;
      rows.push({ yj, product_name: "", strength: "", doc_id: docId, source_page: "", found_page: "", quote: "照合不能", reason: "下書きに品目がない（抽出結果が空）", ratio: "", missing: "", url: d.source_url });
      continue;
    }
    const pages = getPages(docId);
    for (const p of products) {
      const base = { yj, product_name: p.product_name, strength: p.strength, doc_id: docId, source_page: p.source_page ?? "", url: d.source_url,
        imprint_front: p.imprint_front, imprint_back: p.imprint_back, color: p.color, size_long_mm: p.size_long_mm, size_short_mm: p.size_short_mm, thickness_mm: p.thickness_mm, source_quote: p.source_quote };
      if (!pages) { rows.push({ ...base, found_page: "", quote: "照合不能", reason: "PDFが無い", ratio: "", missing: "" }); continue; }
      const page = Number(p.source_page) || 1;
      const allNorm = pages.map((x) => x.norm).join(""); const allSpaced = pages.map((x) => x.spaced).join(" ");
      // 文字が取り出せないPDF：根拠のページとその前後2ページのどれにも、ひらがながほとんど無い。
      // （図だけのPDFのほか、文字化けした記号が並ぶPDFもある。文字化けは漢字に見える記号になるので、ひらがなで数える）
      const hiraOf = (pg) => (pg.norm.match(/\p{Script=Hiragana}/gu) ?? []).length / 2; // 本文を2通り取ってつないでいるので半分に
      const near = [page, page + 1, page - 1, page + 2, page - 2].filter((n) => n >= 1 && n <= pages.length).map((n) => hiraOf(pages[n - 1]));
      const hira = near.length ? Math.max(...near) : 0;
      if (hira < 50) { rows.push({ ...base, found_page: "", quote: "照合不能", reason: `文字が取り出せない（ひらがな ${Math.round(hira)} 字）`, ratio: "", missing: "" }); continue; }
      const r = checkQuote(pages, page, p.source_quote);
      const pg = pages[r.foundPage - 1];
      const whereT = (v) => { const a = hasText(pg.norm, v); return a === "なし" && hasText(allNorm, v) !== "なし" ? "別ページにあり" : a; };
      const whereN = (v) => { const a = hasNumber(pg.spaced, v); return a === "なし" && hasNumber(allSpaced, v) === "あり" ? "別ページにあり" : a; };
      rows.push({
        ...base, found_page: r.foundPage, quote: r.verdict, reason: "", ratio: r.ratio.toFixed(2), missing: r.missing.join(" | "),
        front_in_text: whereT(p.imprint_front), back_in_text: whereT(p.imprint_back),
        front_in_quote: hasText(norm(p.source_quote), p.imprint_front),
        long_in_text: whereN(p.size_long_mm), short_in_text: whereN(p.size_short_mm), thick_in_text: whereN(p.thickness_mm),
        color_in_text: whereT(p.color),
      });
    }
  }
  return { rows, files: files.length, emptyDrafts };
}

function summarize(rows) {
  const count = (key) => rows.reduce((m, r) => { const k = r[key] ?? "（なし）"; m[k] = (m[k] ?? 0) + 1; return m; }, {});
  return {
    品目の行数: rows.length,
    根拠の文言: count("quote"),
    照合不能の理由: rows.filter((r) => r.quote === "照合不能").reduce((m, r) => { const k = r.reason.replace(/（[^）]*\d+ 字）/, ""); m[k] = (m[k] ?? 0) + 1; return m; }, {}),
    刻印_表_本文: count("front_in_text"),
    刻印_裏_本文: count("back_in_text"),
    長径_本文: count("long_in_text"),
    短径_本文: count("short_in_text"),
    厚さ_本文: count("thick_in_text"),
    色_本文: count("color_in_text"),
  };
}

const COLS = ["yj", "product_name", "strength", "priority", "review_reason", "quote", "ratio", "reason", "source_page", "found_page", "missing",
  "imprint_front", "front_in_text", "front_in_quote", "imprint_back", "back_in_text",
  "size_long_mm", "long_in_text", "size_short_mm", "short_in_text", "thickness_mm", "thick_in_text", "color", "color_in_text",
  "source_quote", "doc_id", "url"];
const toCsv = (rows) => "﻿" + [COLS.join(","), ...rows.map((r) => COLS.map((c) => csvCell(r[c])).join(","))].join("\n") + "\n";

/**
 * 目で見るものと、その理由・優先度
 *   高：根拠の文言が不一致、または大きさの数字が添付文書のどこにも無い
 *   中：根拠の文言が近似、または刻印・大きさがそのページに無い（刻印は図だけに載っていることがある）
 *   低：色の表現がそのページに無い
 */
function review(r) {
  if (r.quote === "照合不能") return { priority: "", reasons: [] };
  const hi = [], mid = [], lo = [];
  if (r.quote === "不一致") hi.push("根拠の文言が不一致");
  if (r.quote === "近似（要目視）") mid.push("根拠の文言が近似");
  for (const [k, label] of [["long_in_text", "長径"], ["short_in_text", "短径"], ["thick_in_text", "厚さ"]]) {
    if (r[k] === "なし") hi.push(`${label}がどのページにも無い`);
    if (r[k] === "別ページにあり") mid.push(`${label}が別のページにある`);
  }
  for (const [k, label] of [["front_in_text", "刻印（表）"], ["back_in_text", "刻印（裏）"]]) {
    if (r[k] === "なし") mid.push(`${label}がどのページにも無い（図の可能性）`);
    if (r[k] === "別ページにあり") mid.push(`${label}が別のページにある`);
  }
  if (r.color_in_text === "なし" || r.color_in_text === "別ページにあり") lo.push("色の表現がそのページに無い");
  const reasons = [...hi, ...mid, ...lo];
  return { priority: hi.length ? "高" : mid.length ? "中" : lo.length ? "低" : "", reasons };
}

if (SELFTEST) {
  // 検査が本当に働くかの試し：すべての検査を通った品目の値をわざと書き換えて、見つけられるかを数える。
  // 見つけられない分が、この照合の限界（書き換えた後の値が、たまたま同じページにある。隣の規格の値など）
  const { rows } = main();
  const good = rows.filter((r) => String(r.quote).startsWith("一致") && r.front_in_text === "あり" && r.long_in_text === "あり");
  const step = Math.max(1, Math.floor(good.length / 500));
  const sample = good.filter((_, i) => i % step === 0).slice(0, 500);
  const cache = new Map();
  const bump = (v) => { const s = String(v); const c = s.at(-1);
    if (/\d/.test(c)) return s.slice(0, -1) + ((Number(c) + 1) % 10);
    if (/[A-Ya-y]/.test(c)) return s.slice(0, -1) + String.fromCharCode(c.charCodeAt(0) + 1);
    return s + "7"; };
  let quote = 0, imprint = 0, size = 0; const slipped = [];
  for (const r of sample) {
    if (!cache.has(r.doc_id)) cache.set(r.doc_id, pagesOf(r.doc_id));
    const pages = cache.get(r.doc_id); const pg = pages[r.found_page - 1];
    // 1. 根拠の文言に、添付文書に無い刻印を足す
    const fake = checkQuote(pages, Number(r.source_page) || 1, `${r.source_quote} 識別コード ZZQ9917`);
    if (!fake.verdict.startsWith("一致")) quote++; else slipped.push(`${r.product_name}（${fake.verdict}、p.${fake.foundPage}、残り ${fake.missing.join("|")}）`);
    // 2. 刻印の最後の 1 文字を変える（141 → 142、SD112 → SD113）
    if (!hasText(pg.norm, bump(r.imprint_front)).startsWith("あり")) imprint++;
    // 3. 長径を 0.3mm 大きくする
    if (hasNumber(pg.spaced, Math.round((Number(r.size_long_mm) + 0.3) * 10) / 10) === "なし") size++;
  }
  const pct = (n) => `${n}/${sample.length}（${((100 * n) / sample.length).toFixed(1)}%）`;
  const result = { 試した品目: sample.length, 文言に無い刻印を足した: pct(quote), 刻印の最後の1文字を変えた: pct(imprint), 長径を0_3mm変えた: pct(size) };
  console.log(JSON.stringify(result, null, 2));
  if (slipped.length) console.log("足した刻印を見逃した品目：\n  " + slipped.join("\n  "));
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "selftest.json"), JSON.stringify(result, null, 2) + "\n");
  process.exit(quote / sample.length >= 0.99 ? 0 : 1); // 足した刻印を 99% 以上見つけられなければ、検査が壊れているとみなす
} else {
  const { rows, files, emptyDrafts } = main();
  fs.mkdirSync(OUT, { recursive: true });
  for (const r of rows) { const v = review(r); r.priority = v.priority; r.review_reason = v.reasons.join("；"); }
  const rank = { 高: 0, 中: 1, 低: 2 };
  const toReview = rows.filter((r) => r.priority).sort((a, b) => rank[a.priority] - rank[b.priority]);
  const unable = rows.filter((r) => r.quote === "照合不能");
  fs.writeFileSync(path.join(OUT, "quote-check.csv"), toCsv(rows));
  fs.writeFileSync(path.join(OUT, "needs-review.csv"), toCsv(toReview));
  fs.writeFileSync(path.join(OUT, "unable.csv"), toCsv(unable));
  const byReason = {};
  for (const r of toReview) for (const x of r.review_reason.split("；")) byReason[x] = (byReason[x] ?? 0) + 1;
  const clean = rows.filter((r) => r.quote !== "照合不能" && !r.priority).length;
  const summary = {
    実行日: new Date().toISOString().slice(0, 10), モデル: MODEL, 下書きファイル数: files, うち品目なし: emptyDrafts,
    ...summarize(rows),
    すべての検査を通った行数: clean,
    目で見る行数: { 合計: toReview.length, 高: toReview.filter((r) => r.priority === "高").length, 中: toReview.filter((r) => r.priority === "中").length, 低: toReview.filter((r) => r.priority === "低").length },
    目で見る理由: byReason,
    照合不能の行数: unable.length,
    検算: `通った ${clean} + 目で見る ${toReview.length} + 照合不能 ${unable.length} = ${clean + toReview.length + unable.length}（全 ${rows.length} 行）`,
  };
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));
}
