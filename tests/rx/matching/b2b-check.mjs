// 先発→別の先発の自動選択（origin-scan の brandToBrand）を厚労省の一覧で確かめる。node b2b-check.mjs <リポジトリ> <origin-scan の出力.json>
// 両方が一覧に先発として同じ販売名で載り、一覧の YJ の上 9 桁・規格が同じなら「併売品」とみなす
import fs from "node:fs";
import path from "node:path";

const [ROOT, scanFile] = process.argv.slice(2);
const csv = fs.readdirSync(path.join(ROOT, "data/parent")).find((f) => /^naifuku-tablets-.*\.csv$/.test(f));
const parse = (l) => { const o = []; let c = "", q = false; for (const ch of l) { if (q) { if (ch === '"') q = false; else c += ch; } else if (ch === '"') q = true; else if (ch === ",") { o.push(c); c = ""; } else c += ch; } o.push(c); return o; };
const lines = fs.readFileSync(path.join(ROOT, "data/parent", csv), "utf8").trim().split("\n");
const head = parse(lines[0]);
const nk = (s) => String(s ?? "").normalize("NFKC").replace(/[\s　®]/g, "").toLowerCase();
const byName = new Map(lines.slice(1).map((l) => { const o = Object.fromEntries(head.map((h, i) => [h, parse(l)[i]])); return [nk(o.brand_name), o]; }));
const pairs = JSON.parse(fs.readFileSync(scanFile, "utf8")).brandToBrand;
const rows = pairs.map(({ P, F }) => {
  const a = byName.get(nk(P)), b = byName.get(nk(F));
  const ok = !!a && !!b && a.is_original === "True" && b.is_original === "True" && a.yj_code.slice(0, 9) === b.yj_code.slice(0, 9) && a.strength === b.strength;
  return { P, F, ok, a: a ? `${a.yj_code} ${a.maker} ${a.strength}` : "一覧に無い", b: b ? `${b.yj_code} ${b.maker} ${b.strength}` : "一覧に無い" };
});
console.log(JSON.stringify({ n: rows.length, notListed: rows.filter((r) => !r.ok) , rows }));
