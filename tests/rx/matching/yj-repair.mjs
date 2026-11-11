// match-data の YJ の上 9 桁のうち、親マスタの YJ と違うもの（統一名の行の選び直し・同じ名前の製品からの補い）を、厚労省の一覧で確かめる。
// node yj-repair.mjs <リポジトリ> → { repicks, fills, bad }
// 選び直し：選んだ上 9 桁の統一名の行の剤形（口腔内崩壊・チュアブル・カプセル・徐放・腸溶・普通）と規格が、製品の販売名・規格と同じか（品質の読み方）
// 補い：一覧に同じ販売名の行があれば、その上 9 桁と同じか
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
const { MATCH_DATA: D } = await import(pathToFileURL(path.join(ROOT, "lib/match-data.ts")).href);
const pm = JSON.parse(fs.readFileSync(path.join(ROOT, "data/parent/parent-master.json"), "utf8")).products;
const csv = fs.readdirSync(path.join(ROOT, "data/parent")).find((f) => /^naifuku-tablets-.*\.csv$/.test(f));
const parse = (l) => { const o = []; let c = "", q = false; for (const ch of l) { if (q) { if (ch === '"') q = false; else c += ch; } else if (ch === '"') q = true; else if (ch === ",") { o.push(c); c = ""; } else c += ch; } o.push(c); return o; };
const lines = fs.readFileSync(path.join(ROOT, "data/parent", csv), "utf8").trim().split("\n");
const head = parse(lines[0]);
const rows = lines.slice(1).map((l) => Object.fromEntries(head.map((h, i) => [h, parse(l)[i]])));
const nk = (s) => String(s ?? "").normalize("NFKC").replace(/[\s　®]/g, "").toLowerCase();
const byYj = new Map(rows.map((r) => [r.yj_code, r]));
const byName = new Map(rows.map((r) => [nk(r.brand_name), r]));
const form = (name) => {
  const n = nk(name).replace(/「[^」]*」/g, "");
  if (/チュアブル/.test(n)) return "チュアブル";
  if (/口腔内崩壊|od錠|(?<![a-z])d錠|レディタブ|ザイディス/.test(n)) return "OD";
  if (/徐放|持続|(cr|sr|la|l|r|tr|xr|er)(錠|カプセル)/.test(n)) return "徐放";
  if (/腸溶|en錠/.test(n)) return "腸溶";
  if (/カプセル/.test(n)) return "カプセル";
  return "錠";
};
const num = (s) => (nk(s).match(/\d+(\.\d+)?/) ?? [""])[0].replace(/\.0+$/, "");
const first = new Map();
for (const p of pm) if (!first.has(p.brand_name)) first.set(p.brand_name, []), first.get(p.brand_name).push(p); else first.get(p.brand_name).push(p);
const out = { repicks: 0, fills: 0, bad: [] };
for (const [name, , , , yj9] of D.products) {
  if (!yj9) continue;
  const ps = first.get(name) ?? [];
  if (ps.some((p) => p.yj_code && p.yj_code.slice(0, 9) === yj9)) continue; // 親マスタのどれかの行と同じ
  const p = ps[0];
  const own = p && byYj.get(p.yj_code);
  const listed = byName.get(nk(name));
  if (own && !own.maker) {
    out.repicks++;
    const target = rows.filter((r) => r.yj_code.startsWith(yj9)); // 統一名の行が無い上 9 桁（OD 錠など）は、販売名の行で見る
    const ok = target.some((r) => form(r.brand_name) === form(name) && num(r.strength) === num(p.strength));
    if (!ok) out.bad.push(`選び直し ${name}（${p.strength}）：${p.yj_code}=${own.brand_name} → ${yj9}=${target.map((r) => r.brand_name).join("、") || "（統一名の行なし）"}`);
  } else {
    out.fills++;
    if (listed && listed.yj_code.slice(0, 9) !== yj9) out.bad.push(`補い ${name}：→ ${yj9}、一覧の同じ販売名は ${listed.yj_code}`);
  }
}
console.log(JSON.stringify(out));
