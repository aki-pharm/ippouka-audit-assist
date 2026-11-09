/**
 * PMDA の一覧ページ（captures/pmda-gl/*.html、成分ごと）から、錠剤・カプセルの「製品」の表を作る。
 *   node scripts/build-products.cjs → data/parent/products.csv
 * 厚労省の薬価基準リストは、同じ薬価の後発品を「統一名」1行にまとめるため、後発品の販売名の多くが載らない。
 * PMDA の一覧には製品ごとの販売名と添付文書があるので、こちらを製品の母集団にする。
 * 列：product_key（正規化した販売名）, brand_name, maker, doc_id, pdf_date, group（YJ先頭8桁＝成分＋剤形）, strength（販売名から推定）,
 *     yj_code（厚労省リストに同名があればそのコード、無ければ統一名行のコード）, in_mhlw（厚労省リストに同名の行があるか）
 */
const fs = require("fs");
const path = require("path");
const norm = (s) => String(s || "").normalize("NFKC").replace(/[\s※＊*]/g, "").replace(/[「『]/g, "「").replace(/[」』]/g, "」");
const rows = fs.readFileSync(fs.readdirSync("data/parent").filter((f) => /^naifuku-tablets-\d+\.csv$/.test(f)).sort().map((f) => path.join("data/parent", f)).pop(), "utf8")
  .split("\n").slice(1).filter(Boolean).map((x) => x.split(",").map((s) => s.replace(/^"|"$/g, "")));
const byName = new Map(rows.map((r) => [norm(r[3]), r]));
const unified = new Map(); // group+strength → 統一名行の yj_code
for (const r of rows) if (!r[4]) unified.set(r[0].slice(0, 8) + "|" + norm(r[2]), r[0]);
const strengthOf = (name) => { const m = name.normalize("NFKC").match(/(\d+(?:\.\d+)?)\s*(mg|μg|µg|mcg|g|単位|万単位|IU)/i); return m ? m[1] + m[2].replace(/µ|mcg/, "μ") : ""; };
const out = new Map();
for (const f of fs.readdirSync("captures/pmda-gl")) {
  const group = f.replace(".html", "");
  const html = fs.readFileSync(path.join("captures/pmda-gl", f), "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
  for (const m of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const row = m[1]; const pdf = row.match(/ResultDataSetPDF\/([0-9A-Z_]+)'>PDF\((\d{4})年(\d{2})月(\d{2})日\)/); if (!pdf) continue;
    const pop = row.match(/popUp\("([^"]*)"\)/); const td = (row.match(/<td[^>]*>([\s\S]*?)<\/td>/) || [, ""])[1].replace(/<[^>]+>/g, "").trim();
    const maker = (row.match(/<td>([^<]*(?:製造販売元|販売元|製造元)[^<]*)<\/td>/) || [, ""])[1].replace(/\s+/g, " ").trim();
    for (const n of (pop ? pop[1] : td).split("／").map((s) => s.trim()).filter(Boolean)) {
      if (!/錠|カプセル/.test(n)) continue;
      const key = norm(n); const prev = out.get(key);
      const date = `${pdf[2]}-${pdf[3]}-${pdf[4]}`;
      if (prev && prev.pdf_date >= date) continue; // 同名が複数の文書に載るときは新しい方
      const mh = byName.get(key);
      out.set(key, { product_key: key, brand_name: n, maker, doc_id: pdf[1], pdf_date: date, group, strength: strengthOf(n), yj_code: mh ? mh[0] : "", in_mhlw: !!mh });
    }
  }
}
// 統一名行のコードを補う（成分グループが同じで規格の文字が一致するもの）
for (const p of out.values()) if (!p.yj_code) { for (const [k, yj] of unified) { const [g, spec] = k.split("|"); if (g === p.group && p.strength && spec.startsWith(p.strength)) { p.yj_code = yj; break; } } }
const list = [...out.values()].sort((a, b) => (a.group + a.brand_name < b.group + b.brand_name ? -1 : 1));
const cols = ["product_key", "brand_name", "maker", "doc_id", "pdf_date", "group", "strength", "yj_code", "in_mhlw"];
const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
fs.writeFileSync("data/parent/products.csv", cols.join(",") + "\n" + list.map((p) => cols.map((c) => (typeof p[c] === "boolean" ? (p[c] ? "True" : "False") : q(p[c]))).join(",")).join("\n") + "\n");
const inM = list.filter((p) => p.in_mhlw).length;
console.log(`製品 ${list.length}（厚労省リストに同名あり ${inM}、無し ${list.length - inM}）、添付文書 ${new Set(list.map((p) => p.doc_id)).size} → data/parent/products.csv`);
