/**
 * 刻印検索（試作）：親マスタ（data/parent/parent-master.json）から、刻印の文字で候補を探す。
 *   node scripts/imprint-search.cjs "GS 13" [--color 白] [--shape round] [--size 7.1] [--all]
 * 刻印は空白・全角半角・大文字小文字を無視して部分一致。色は前方一致、大きさは ±0.6mm。
 * 既定では「一包化しない」印の付いた製品を除く（--all で含める）。
 * 候補を示すだけで、確定は薬剤師（PTP・お薬手帳・添付文書で）。
 */
const fs = require("fs");
const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const q = process.argv[2]; if (!q || q.startsWith("--")) { console.error('使い方: node scripts/imprint-search.cjs "刻印" [--color 白] [--shape round] [--size 7.1] [--all]'); process.exit(1); }
const norm = (s) => String(s ?? "").normalize("NFKC").replace(/[\s・･.\-－（）()]/g, "").toLowerCase();
const color = arg("--color"), shape = arg("--shape"), size = arg("--size") ? Number(arg("--size")) : null, all = process.argv.includes("--all");
const { products } = JSON.parse(fs.readFileSync("data/parent/parent-master.json", "utf8"));
const rank = { verified: 0, confirmed: 1, draft: 2, none: 3 };
const hits = [];
for (const p of products) {
  if (p.status === "none") continue;
  if (!all && p.flags.includes("一包化しない")) continue;
  const im = [p.imprint_front, p.imprint_back].filter((x) => x && x !== "なし" && x !== "未確認").map(norm);
  if (!im.some((x) => x.includes(norm(q)))) continue;
  if (color && !String(p.color).startsWith(color)) continue;
  if (shape && p.shape !== shape) continue;
  if (size != null && (p.size_long_mm === "" || p.size_long_mm == null || Math.abs(Number(p.size_long_mm) - size) > 0.6)) continue;
  hits.push(p);
}
const exact = (p) => (norm(p.imprint_front) === norm(q) || norm(p.imprint_back) === norm(q) ? 0 : 1);
hits.sort((a, b) => exact(a) - exact(b) || rank[a.status] - rank[b.status] || a.brand_name.localeCompare(b.brand_name, "ja"));
const label = { verified: "実物確認ずみ", confirmed: "添付文書で確認ずみ", draft: "AI下書き" };
console.log(`「${q}」の候補 ${hits.length} 件${color ? `（色 ${color}）` : ""}${shape ? `（形 ${shape}）` : ""}${size != null ? `（長径 ${size}±0.6mm）` : ""}${all ? "" : "（一包化しない品目は除く）"}`);
for (const h of hits.slice(0, 15)) console.log(`- ${h.brand_name}（${h.maker || "?"}）| 表 ${h.imprint_front || "?"} / 裏 ${h.imprint_back || "?"} | ${h.color} ${h.shape || "?"} ${h.size_long_mm || "?"}mm | ${label[h.status]}${h.flags.length ? " | " + h.flags.join("・") : ""}`);
if (hits.length > 15) console.log(`  …他 ${hits.length - 15} 件`);
