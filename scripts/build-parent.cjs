/**
 * 厚労省「薬価基準収載品目リスト」（内用薬 Excel）→ 親マスタの骨格 CSV（錠剤・カプセルのみ）
 *   node scripts/build-parent.cjs <内用薬.xlsx> [YYYYMMDD]
 * 出力：data/parent/naifuku-tablets-<YYYYMMDD>.csv
 * 列：yj_code（薬価基準収載医薬品コード）, generic_name, strength, brand_name, maker, dosage_form, is_generic, is_original, price, expiry
 * 全角英数字・記号は半角に寄せる。メーカー欄が空の行は統一名収載（実製品ではない）。
 */
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const [src, dateArg] = process.argv.slice(2);
if (!src) { console.error("使い方: node scripts/build-parent.cjs <内用薬.xlsx> [YYYYMMDD]"); process.exit(1); }
const date = dateArg || (src.match(/(\d{8})/) || [])[1] || new Date().toISOString().slice(0, 10).replace(/-/g, "");
const z2h = (s) => String(s ?? "").normalize("NFKC").replace(/　/g, " ").trim();
const wb = XLSX.readFile(src);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
const out = [];
for (const r of rows.slice(1)) {
  const spec = z2h(r[3]);
  const form = spec.includes("錠") ? "tablet" : spec.includes("カプセル") ? "capsule" : null;
  if (!form) continue;
  out.push({ yj_code: String(r[1]).trim(), generic_name: z2h(r[2]), strength: spec, brand_name: z2h(r[7]), maker: z2h(r[8]), dosage_form: form, is_generic: !!r[9], is_original: !!r[10], price: String(r[12] ?? ""), expiry: z2h(r[13]) });
}
out.sort((a, b) => (a.yj_code < b.yj_code ? -1 : 1));
const cols = Object.keys(out[0]);
const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
const file = path.join("data/parent", `naifuku-tablets-${date}.csv`);
fs.writeFileSync(file, cols.join(",") + "\n" + out.map((o) => cols.map((c) => (typeof o[c] === "boolean" ? (o[c] ? "True" : "False") : q(o[c]))).join(",")).join("\n") + "\n");
console.log(`${file}: ${out.length} 行（錠 ${out.filter((o) => o.dosage_form === "tablet").length}、カプセル ${out.filter((o) => o.dosage_form === "capsule").length}）`);
