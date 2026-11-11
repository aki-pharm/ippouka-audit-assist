// 自動で選んだ組のうち、処方と採用品の YJ の上 9 桁（成分・剤形・規格の区分）が違うものを数える。node yj9-scan.mjs <リポジトリ>
// YJ の上 9 桁が違う＝厚労省の区分では別の製剤（効能違いの MT・ZA、放出の違うワントラム・ツートラム、OD のレディタブなど）
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
// --agree：どの組にも「処方 → 採用品」の事前合意を渡す（合意で柵を越えないかを見る）
const AGREE = process.argv.includes("--agree");
const { MATCH_DATA: D } = await import(pathToFileURL(path.join(ROOT, "lib/match-data.ts")).href);
const { matchRx } = await import(pathToFileURL(path.join(ROOT, "lib/matching.ts")).href);
const pm = JSON.parse(fs.readFileSync(path.join(ROOT, "data/parent/parent-master.json"), "utf8")).products.filter((p) => p.status !== "none" && p.yj_code && p.yj_code.length >= 9);
// 統一名（メーカーの無い行）を指す YJ は製品ごとの区分にならないので除く
const csv = fs.readdirSync(path.join(ROOT, "data/parent")).find((f) => /^naifuku-tablets-.*\.csv$/.test(f));
const unified = new Set(fs.readFileSync(path.join(ROOT, "data/parent", csv), "utf8").split("\n").filter((l) => /^"\d/.test(l)).map((l) => l.split(",")).filter((c) => c[4] === '""').map((c) => c[0].replace(/"/g, "")));
const byKey = new Map();
for (const [n, ki] of D.products) { const k = D.keys[ki].split("|").slice(0, 2).join("|"); if (!byKey.has(k)) byKey.set(k, new Set()); byKey.get(k).add(n); }
const prod = new Map(pm.map((p) => [p.brand_name, p]));
const out = [];
let selected = 0;
for (const [, set] of byKey) {
  const names = [...set].filter((n) => prod.has(n) && !unified.has(prod.get(n).yj_code));
  if (names.length < 2) continue;
  // 大きい組は 1 つの YJ の上 9 桁あたり 3 製品まで
  const per = new Map();
  for (const n of names) { const y = prod.get(n).yj_code.slice(0, 9); per.set(y, [...(per.get(y) ?? []), n]); }
  const use = [...per.values()].flatMap((v) => v.slice(0, 3));
  for (const P of use) for (const F of use) {
    if (P === F) continue;
    const p = prod.get(P), f = prod.get(F);
    const m = matchRx(P, p.strength, [{ id: F, brand_name: F, generic_name: "", strength: f.strength, adopted: true, product_key: f.product_key ?? F }], D, AGREE ? { agreements: [{ from: P, to: F, reason: "品質の走査", agreed_by: "品質", agreed_at: "2026-11-11" }] } : {});
    if (!m.best) continue;
    selected++;
    if (p.yj_code.slice(0, 9) !== f.yj_code.slice(0, 9)) out.push(`${P}（${p.yj_code.slice(0, 9)}）→ ${F}（${f.yj_code.slice(0, 9)}）`);
  }
}
console.log(JSON.stringify({ selected, differ: out }));
