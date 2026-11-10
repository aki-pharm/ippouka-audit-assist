/**
 * メーカー選択の索引を作る（親マスタから、成分・規格・剤形ごとに製品をまとめる）。
 *   node scripts/build-maker-index.cjs                 … data/parent/maker-index.json を作る
 *   node scripts/build-maker-index.cjs --link-master   … あわせて data/master.json の各行に product_key・drug_key・maker_state を入れる
 * 入力：data/parent/parent-master.json、data/parent/naifuku-tablets-*.csv（成分名）
 * 出力：data/parent/maker-index.json（画面の「変更」で出す候補。サーバ側の /api/makers が読む）
 *
 * 薬の鍵（drug_key）は「成分・剤形コード|規格|剤形」。scripts/ops/build-ops-master.py と同じ決め方
 * （剤形は販売名から：錠／OD錠／カプセル／チュアブル錠／ODフィルム を区別）。lib/makers.ts の drugKey() も同じ。
 * 親マスタは全医薬品の公開データなので、索引も全部の薬を入れる。施設の採用品（data/private/）で絞らない
 * （絞って commit すると、どの施設が何を採用しているかが見えてしまうため）。
 */
const fs = require("fs");
const path = require("path");

const norm = (s) => (s || "").normalize("NFKC").replace(/[\s・･®（）()「」]/g, "").toLowerCase();
const formOf = (name) => {
  const n = (name || "").normalize("NFKC");
  if (n.includes("ODフィルム")) return "ODフィルム";
  if (n.includes("OD錠") || n.includes("口腔内崩壊")) return "OD錠";
  if (n.includes("カプセル")) return "カプセル";
  if (n.includes("チュアブル")) return "チュアブル錠";
  if (n.includes("錠")) return "錠";
  return "その他";
};
const strengthKey = (s) => norm(s).replace("mg", "").replace("ug", "μg");
const drugKey = (group, strength, brand) => `${group}|${strengthKey(strength)}|${formOf(brand)}`;
const stem = (name) => {
  let n = (name || "").normalize("NFKC").replace(/「.*?」|\(.*?\)|（.*?）/g, "");
  n = n.split(/OD錠|錠|カプセル|配合錠|チュアブル|ODフィルム/)[0];
  return n.replace(/\d+(\.\d+)?\s*(mg|μg|ug|g|単位)?$/, "").trim();
};
// 名前の照合（含量の書き方だけ違う「フォリアミン錠5mg」と「フォリアミン錠」を同じにする緩いキー。規格の一致も見る）
const nameKey = (s) => (s || "").normalize("NFKC").replace(/[\s　®]/g, "").replace(/[（(][^）)]*[）)]/g, "").replace(/[‐‑‒–—−]/g, "-").toLowerCase();
const loose = (s) => nameKey(s).replace(/\d+(\.\d+)?(mg|μg|mcg|g)?$/, "");

const readCsv = (f) => {
  const text = fs.readFileSync(f, "utf8").replace(/^﻿/, "");
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (ch !== "\r") cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const [h, ...b] = rows;
  return b.filter((r) => r.length > 1).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ""])));
};

const pm = JSON.parse(fs.readFileSync("data/parent/parent-master.json", "utf8")).products;
const genericByYj = {};
for (const f of fs.readdirSync("data/parent").sort()) {
  if (f.startsWith("naifuku-tablets-") && f.endsWith(".csv"))
    for (const r of readCsv(path.join("data/parent", f))) genericByYj[r.yj_code] = r.generic_name;
}

const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0)));
const STATUS_ORDER = { verified: 0, confirmed: 1, draft: 2 };
const drugs = {};
let nProducts = 0;
for (const p of pm) {
  if (p.status === "none") continue; // 外観の下書きがない製品（組み合わせ品など）は候補にしない
  const key = drugKey(p.group, p.strength, p.brand_name);
  const d = (drugs[key] ??= { generic_name: "", strength: p.strength, form: formOf(p.brand_name), products: [] });
  if (!d.generic_name && genericByYj[p.yj_code]) d.generic_name = genericByYj[p.yj_code];
  // 空の欄（null・空文字・空配列）は書かない（索引を小さくするため）。読む側（lib/makers.ts）で null として扱う
  d.products.push(compact({
    product_key: p.product_key,
    brand_name: p.brand_name,
    maker: p.maker || "",
    imprint_front: p.imprint_front,
    imprint_back: p.imprint_back,
    imprint_note: p.imprint_note || null,
    color: p.color,
    color_hex: p.color_hex || null,
    shape: p.shape || null,
    size_long_mm: p.size_long_mm ?? null,
    size_short_mm: p.size_short_mm ?? null,
    thickness_mm: p.thickness_mm ?? null,
    score_line: p.score_line ?? null,
    status: p.status,
    source_url: p.source_url || null,
    source_revision: p.source_revision || null,
    verified_by: p.verified_by || null,
    verified_at: p.verified_at || null,
    flags: p.flags || [],
  }));
  nProducts++;
}
for (const d of Object.values(drugs)) {
  if (!d.generic_name) d.generic_name = stem(d.products[0].brand_name);
  d.products.sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || a.brand_name.localeCompare(b.brand_name, "ja"));
}
const sorted = Object.fromEntries(Object.keys(drugs).sort().map((k) => [k, drugs[k]]));
const out = { built_at: new Date().toISOString(), source: "data/parent/parent-master.json", drug_count: Object.keys(sorted).length, product_count: nProducts, drugs: sorted };
fs.writeFileSync("data/parent/maker-index.json", JSON.stringify(out) + "\n");
const multi = Object.values(sorted).filter((d) => d.products.length > 1).length;
console.log(`maker-index.json：薬 ${out.drug_count}（うち候補が 2 つ以上 ${multi}）、製品 ${nProducts}、${(fs.statSync("data/parent/maker-index.json").size / 1e6).toFixed(2)} MB`);

// ---------- --link-master：data/master.json の各行を親マスタの製品につなぐ ----------
if (process.argv.includes("--link-master")) {
  const master = JSON.parse(fs.readFileSync("data/master.json", "utf8"));
  const byName = new Map(pm.map((p) => [nameKey(p.brand_name), p]));
  const byLoose = new Map();
  for (const p of pm) byLoose.set(loose(p.brand_name), [...(byLoose.get(loose(p.brand_name)) ?? []), p]);
  let linked = 0;
  const next = master.map((t) => {
    const names = [t.brand_name, ...(t.aliases ?? [])];
    let p = names.map((n) => byName.get(nameKey(n))).find(Boolean);
    if (!p) {
      const hits = names.flatMap((n) => byLoose.get(loose(n)) ?? []).filter((x) => strengthKey(x.strength) === strengthKey(t.strength));
      if (new Set(hits.map((x) => x.product_key)).size === 1) p = hits[0];
    }
    if (p) linked++;
    else console.log(`  親マスタにつながらない：${t.id} ${t.brand_name}`);
    // 既存の値はそのまま。maker の後ろに 3 つの欄を足す（すでにあれば上書きしない）
    const o = {};
    for (const [k, v] of Object.entries(t)) {
      if (k === "product_key" || k === "drug_key" || k === "maker_state") continue;
      o[k] = v;
      if (k === "maker") {
        o.product_key = t.product_key ?? p?.product_key ?? null;
        o.drug_key = t.drug_key ?? (p ? drugKey(p.group, p.strength, p.brand_name) : null);
        // デモ施設の 28 品目は、実物の写真で確認した製品をそのまま「今のメーカー」とする
        o.maker_state = t.maker_state ?? (t.status === "verified" ? "確認ずみ（現物）" : "未選択");
      }
    }
    return o;
  });
  fs.writeFileSync("data/master.json", JSON.stringify(next, null, 2) + "\n");
  console.log(`data/master.json：${linked}/${master.length} 品目を親マスタの製品につないだ`);
}
