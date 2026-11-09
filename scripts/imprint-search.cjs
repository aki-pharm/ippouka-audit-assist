/**
 * 刻印検索（試作）：親マスタの下書きから、刻印の文字で候補を探す。
 *   node scripts/imprint-search.cjs "GS 13" [--color 白] [--shape round] [--size 7.1]
 * 刻印は空白・全角半角・大文字小文字を無視して部分一致。色は前方一致、大きさは ±0.6mm。
 * 候補を示すだけで、確定は薬剤師（PTP・お薬手帳・添付文書で）。
 */
const fs = require("fs");
const path = require("path");
const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const q = process.argv[2]; if (!q) { console.error('使い方: node scripts/imprint-search.cjs "刻印" [--color 白] [--shape round] [--size 7.1]'); process.exit(1); }
const norm = (s) => String(s ?? "").normalize("NFKC").replace(/[\s・･.\-－]/g, "").toLowerCase();
const color = arg("--color"), shape = arg("--shape"), size = arg("--size") ? Number(arg("--size")) : null;
const dir = "data/parent/drafts/claude-sonnet-5-5";
const rows = Object.fromEntries(fs.readFileSync("data/parent/naifuku-tablets-20261101.csv", "utf8").split("\n").slice(1).filter(Boolean).map((l) => { const v = l.split(",").map((s) => s.replace(/^"|"$/g, "")); return [v[0], v]; }));
const hits = [];
for (const f of fs.readdirSync(dir)) {
  const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); const p = d.products[0]; if (!p) continue;
  const im = [p.imprint_front, p.imprint_back].filter((x) => x && x !== "なし" && x !== "未確認").map(norm);
  if (!im.some((x) => x.includes(norm(q)))) continue;
  if (color && !String(p.color).startsWith(color)) continue;
  if (shape && p.shape !== shape) continue;
  if (size != null && (p.size_long_mm == null || Math.abs(p.size_long_mm - size) > 0.6)) continue;
  const r = rows[f.replace(".json", "")] || [];
  hits.push({ yj: f.replace(".json", ""), name: r[3] || p.product_name, maker: r[4] || "", front: p.imprint_front, back: p.imprint_back, color: p.color, shape: p.shape, size: p.size_long_mm, status: d.status });
}
hits.sort((a, b) => (norm(a.front) === norm(q) ? -1 : 1) - (norm(b.front) === norm(q) ? -1 : 1));
console.log(`「${q}」の候補 ${hits.length} 件${color ? `（色 ${color}）` : ""}${shape ? `（形 ${shape}）` : ""}${size != null ? `（長径 ${size}±0.6mm）` : ""}`);
for (const h of hits.slice(0, 15)) console.log(`- ${h.name}（${h.maker}）| 表 ${h.front} / 裏 ${h.back} | ${h.color} ${h.shape ?? "?"} ${h.size ?? "?"}mm | ${h.status}`);
if (hits.length > 15) console.log(`  …他 ${hits.length - 15} 件`);
