/**
 * 親マスタを 1 つにまとめる。
 *   node scripts/build-parent-master.cjs
 * 入力：
 *   data/parent/products.csv                      … 製品の母集団（PMDA 由来、7,146 製品）
 *   data/parent/drafts/claude-sonnet-5-5/<yj>.json … 品目単位の下書き（厚労省リストと同名の製品）
 *   data/parent/drafts-docs/claude-haiku-5-5/<doc_id>.json … 文書単位の下書き（残りの製品）
 *   data/parent/review-imprint-front.csv          … 人（AKI）が確認した刻印と備考
 *   data/master.json                              … 運用マスタ（実物で確認ずみの品目）
 * 出力：
 *   data/parent/parent-master.csv / parent-master.json … 製品 1 行＝外観・出典・確認状態・運用上の印
 * 主キーは product_key（販売名の正規化）。status は verified（実物確認）> confirmed（添付文書を人が確認）> draft（AI の下書きのみ）> none（下書きなし）
 */
const fs = require("fs");
const path = require("path");

const norm = (s) => (s || "").normalize("NFKC").replace(/[\s　®]/g, "").replace(/[（(][^）)]*[）)]/g, "").replace(/[‐‑‒–—−]/g, "-").toLowerCase();
// 「フォリアミン錠5mg」と「フォリアミン錠」、「アスパラ-CA錠200mg」と「アスパラ-CA錠200」のように、含量の書き方だけ違う名前を同一視するための緩いキー
// 末尾の含量を丸ごと落とす。規格違いが同じキーになるので、運用マスタ側でキーが 1 件に決まるときだけ使う
const loose = (s) => norm(s).replace(/\d+(\.\d+)?(mg|μg|mcg|g)?$/, "");
const parseCsv = (text) => {
  const rows = []; let row = [], cur = "", q = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (ch !== "\r") cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
};
const readCsv = (f) => { const [h, ...b] = parseCsv(fs.readFileSync(f, "utf8")); return b.filter((r) => r.length > 1).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ""]))); };
const csvCell = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

const products = readCsv("data/parent/products.csv");
const review = readCsv("data/parent/review-imprint-front.csv");
const master = JSON.parse(fs.readFileSync("data/master.json", "utf8"));

const SONNET = "data/parent/drafts/claude-sonnet-5-5", HAIKU = "data/parent/drafts-docs/claude-haiku-5-5";
const readJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null);

// 下書きの products から、販売名（正規化）→ 規格 → 1 件だけ、の順で選ぶ
function pick(draft, brand, strength) {
  if (!draft || !draft.products || !draft.products.length) return null;
  const ps = draft.products, nb = norm(brand);
  let hit = ps.find((p) => norm(p.product_name) === nb);
  if (hit) return hit;
  hit = ps.find((p) => norm(p.product_name) && (nb.includes(norm(p.product_name)) || norm(p.product_name).includes(nb)));
  if (hit) return hit;
  const ns = norm(strength);
  const byStrength = ps.filter((p) => norm(p.strength) === ns);
  if (byStrength.length === 1) return byStrength[0];
  if (ps.length === 1) return ps[0];
  return null;
}

// 人の確認（review CSV）：yj → 行
const reviewByYj = new Map(review.map((r) => [r.yj, r]));
// 運用マスタ：販売名（正規化、別名も）→ 品目
const masterByName = new Map();
const masterLoose = new Map();
for (const m of master) for (const n of [m.brand_name, ...(m.aliases || [])]) {
  masterByName.set(norm(n), m);
  const k = loose(n); masterLoose.set(k, masterLoose.has(k) && masterLoose.get(k) !== m ? null : m); // 衝突したら使わない
}
// 緩いキーで当たったときは、含量まで一致するものだけ採用（エンレスト錠200mg の確認結果が 100mg に付かないように）
const findMaster = (name, strength) => {
  const m = masterByName.get(norm(name)); if (m) return m;
  const l = masterLoose.get(loose(name));
  return l && strength && norm(l.strength) === norm(strength) ? l : null;
};

const flagsOf = (note) => {
  const f = [];
  if (/一包化しない/.test(note)) f.push("一包化しない");
  if (/識別困難/.test(note)) f.push("外観で識別困難");
  if (/図形/.test(note)) f.push("刻印は図形");
  return f;
};

const out = [], stat = { verified: 0, confirmed: 0, draft: 0, none: 0, sonnet: 0, haiku: 0 };
for (const p of products) {
  let src = null, model = null, draft = null;
  if (p.in_mhlw === "True" && p.yj_code) { draft = pick(readJson(path.join(SONNET, `${p.yj_code}.json`)), p.brand_name, p.strength); if (draft) { model = "claude-sonnet-5-5"; src = "sonnet"; } }
  if (!draft) { draft = pick(readJson(path.join(HAIKU, `${p.doc_id}.json`)), p.brand_name, p.strength); if (draft) { model = "claude-haiku-5-5"; src = "haiku"; } }
  if (!draft && p.yj_code) { draft = pick(readJson(path.join(SONNET, `${p.yj_code}.json`)), p.brand_name, p.strength); if (draft) { model = "claude-sonnet-5-5"; src = "sonnet"; } }
  if (src) stat[src]++;

  const row = {
    product_key: p.product_key, brand_name: p.brand_name, maker: p.maker.replace(/^製造販売元[^／]*／/, ""), yj_code: p.yj_code, group: p.group, strength: p.strength || draft?.strength || "",
    doc_id: p.doc_id, pdf_date: p.pdf_date, source_url: `https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetPDF/${p.doc_id}`,
    color: draft?.color ?? "", color_hex: "", shape: draft?.shape ?? "", size_long_mm: draft?.size_long_mm ?? "", size_short_mm: draft?.size_short_mm ?? "", thickness_mm: draft?.thickness_mm ?? "",
    score_line: draft?.score_line ?? "", imprint_front: draft?.imprint_front ?? "", imprint_back: draft?.imprint_back ?? "", imprint_note: draft?.imprint_note ?? "",
    source_revision: draft?.source_revision ?? "", draft_model: model ?? "", status: draft ? "draft" : "none", verified_by: "", verified_at: "", flags: [], notes: "",
  };

  // 人の確認（添付文書の外形図を見て刻印を埋めたもの）
  const rv = p.yj_code ? reviewByYj.get(p.yj_code) : null;
  if (rv && norm(rv.販売名) === norm(p.brand_name)) {
    if (rv.刻印_表_確認後) {
      row.imprint_front = rv.刻印_表_確認後; row.imprint_back = rv.刻印_裏_確認後 || row.imprint_back;
      row.status = "confirmed"; row.verified_by = "AKI"; row.verified_at = "2026-11-09";
    }
    row.notes = rv.備考 || ""; row.flags = flagsOf(rv.備考 || "");
  }
  // 運用マスタ（実物の写真で確認ずみ）
  const m = findMaster(p.brand_name, row.strength);
  if (m) {
    for (const k of ["color", "color_hex", "shape", "size_long_mm", "size_short_mm", "thickness_mm", "score_line", "imprint_front", "imprint_back", "imprint_note", "source_revision"]) if (m[k] != null && m[k] !== "") row[k] = m[k];
    row.status = "verified"; row.verified_by = m.verified_by || "AKI"; row.verified_at = m.verified_at || "";
  }
  stat[row.status]++;
  out.push(row);
}

const cols = Object.keys(out[0]);
fs.writeFileSync("data/parent/parent-master.csv", "﻿" + [cols.join(","), ...out.map((r) => cols.map((c) => csvCell(Array.isArray(r[c]) ? r[c].join("|") : r[c])).join(","))].join("\n") + "\n");
fs.writeFileSync("data/parent/parent-master.json", JSON.stringify({ built_at: new Date().toISOString(), count: out.length, products: out }, null, 1));
const unk = out.filter((r) => r.status !== "none" && (r.imprint_front === "未確認" || !r.imprint_front)).length;
console.log(`製品 ${out.length}：verified ${stat.verified} / confirmed ${stat.confirmed} / draft ${stat.draft} / none ${stat.none}（下書きの出どころ Sonnet ${stat.sonnet}・Haiku ${stat.haiku}）、刻印（表）が未確認 ${unk}`);
if (stat.none) console.log("下書きが見つからない製品（先頭 15）:\n" + out.filter((r) => r.status === "none").slice(0, 15).map((r) => `  ${r.brand_name}  yj=${r.yj_code} doc=${r.doc_id}`).join("\n"));
