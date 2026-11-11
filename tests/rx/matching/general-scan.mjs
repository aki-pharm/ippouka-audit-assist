// 一般名処方の道：同じ鍵に YJ の上 9 桁の違う製品があるとき（効能・用法の違う製剤のことがある）、【般】の名前から自動で選ぶ組を数える。
// node general-scan.mjs <リポジトリ> → { keys, selected: [...] }
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
const { MATCH_DATA: D } = await import(pathToFileURL(path.join(ROOT, "lib/match-data.ts")).href);
const { matchRx, generalNameKeys } = await import(pathToFileURL(path.join(ROOT, "lib/matching.ts")).href);
const pm = new Map(JSON.parse(fs.readFileSync(path.join(ROOT, "data/parent/parent-master.json"), "utf8")).products.map((p) => [p.brand_name, p]));
const byKey = new Map();
for (const [n, ki, , , y9] of D.products) if (y9) { const k = D.keys[ki]; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push([n, y9]); }
const out = { keys: 0, selected: [] };
for (const [k, list] of byKey) {
  const ys = new Set(list.map(([, y]) => y));
  if (ys.size < 2) continue;
  const [group, sk, form] = k.split("|");
  const g = D.generics[group];
  if (!g || /配合/.test(g)) continue;
  const kind = form === "OD錠" ? "口腔内崩壊錠" : form === "カプセル" ? "カプセル" : form === "錠" ? "錠" : /徐放|YJ徐放/.test(k) ? "徐放錠" : null;
  if (!kind) continue;
  const unit = /μg/.test(sk) ? "" : "mg";
  const gname = `【般】${g}${kind}${sk}${unit}`;
  if (!generalNameKeys(gname, null, null, D).includes(k)) continue; // 一般名で鍵を引けないもの（名前の作り方が合わない）は数えない
  out.keys++;
  // 上 9 桁ごとに 1 製品
  const per = new Map(); for (const [n, y] of list) if (!per.has(y) && pm.has(n)) per.set(y, n);
  for (const [y, n] of per) {
    const p = pm.get(n);
    const m = matchRx(gname, null, [{ id: n, brand_name: n, generic_name: "", strength: p.strength, adopted: true, product_key: p.product_key ?? n }], D);
    if (m.best) out.selected.push(`${gname} → ${n}（${y}／同じ鍵の上 9 桁 ${[...ys].join("・")}）`);
  }
}
console.log(JSON.stringify(out));
