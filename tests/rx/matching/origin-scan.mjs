// 先発・後発の印ごとに、自動で選ぶ組を数える（同じ鍵の製品どうし、施設＝1 製品）。node origin-scan.mjs <リポジトリ>
// 出力：unknownSelected（採用品の印が不明なのに自動で選んだ組）、brandToBrand（先発→別の先発を自動で選んだ組）
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
const { MATCH_DATA: D } = await import(pathToFileURL(path.join(ROOT, "lib/match-data.ts")).href);
const { matchRx } = await import(pathToFileURL(path.join(ROOT, "lib/matching.ts")).href);
const pm = new Map(JSON.parse(fs.readFileSync(path.join(ROOT, "data/parent/parent-master.json"), "utf8")).products.map((p) => [p.brand_name, p]));
const ORIGIN = ["不明", "先発", "後発", "その他"];
// 同じ名前が複数行あれば印がそろうときだけ
const origin = new Map();
const yj9s = new Map(); // 販売名 → YJ の上 9 桁の集まり
for (const [n, , o, , y9] of D.products) { origin.set(n, origin.has(n) && origin.get(n) !== ORIGIN[o] ? "不明" : ORIGIN[o]); yj9s.set(n, new Set([...(yj9s.get(n) ?? []), y9 || "?"])); }
const byKey = new Map();
for (const [n, ki] of D.products) { const k = D.keys[ki].split("|").slice(0, 2).join("|"); if (!byKey.has(k)) byKey.set(k, new Set()); byKey.get(k).add(n); }
const out = { unknownSelected: [], brandToBrand: [], pairs: 0 };
for (const [, set] of byKey) {
  const names = [...set].filter((n) => pm.has(n));
  if (names.length < 2 || names.length > 60) continue;
  for (const P of names) for (const F of names) {
    if (P === F) continue;
    const fo = origin.get(F), po = origin.get(P);
    if (fo !== "不明" && !(po === "先発" && fo === "先発")) continue;
    out.pairs++;
    const f = pm.get(F);
    const m = matchRx(P, pm.get(P).strength, [{ id: F, brand_name: F, generic_name: "", strength: f.strength, adopted: true, product_key: f.product_key ?? F }], D);
    if (!m.best) continue;
    if (fo === "不明") out.unknownSelected.push(`${P} → ${F}`);
    else out.brandToBrand.push({ P, F, yj9P: [...yj9s.get(P)].join("/"), yj9F: [...yj9s.get(F)].join("/") });
  }
}
console.log(JSON.stringify(out));
