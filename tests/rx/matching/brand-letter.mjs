// ブランドの英字の製品（アルダクトンA・チラーヂンS・エルカルチンFF など：鍵の剤形が「英字＋錠／カプセル」で、照合では普通にそろえるもの）を、
// 普通の一般名（【般】…錠／カプセル）で選ぶかを全部出す。node brand-letter.mjs <リポジトリ>
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
const { MATCH_DATA: D } = await import(pathToFileURL(path.join(ROOT, "lib/match-data.ts")).href);
const { matchRx, canonicalKey } = await import(pathToFileURL(path.join(ROOT, "lib/matching.ts")).href);
const pm = new Map(JSON.parse(fs.readFileSync(path.join(ROOT, "data/parent/parent-master.json"), "utf8")).products.map((p) => [p.brand_name, p]));
const out = [];
for (const [name, ki, , yj] of D.products) {
  const k = D.keys[ki];
  if (canonicalKey(k, yj) === k) continue;
  const [group, sk, form] = k.split("|");
  const gen = D.generics[group];
  const p = pm.get(name);
  if (!gen || !p) continue;
  const kind = form.includes("カプセル") ? "カプセル" : "錠";
  const unit = /μg|単位|錠/.test(sk) || !/\d/.test(sk) ? "" : "mg";
  const g = `【般】${gen}${kind}${sk}${unit}`;
  const m = matchRx(g, p.strength, [{ id: name, brand_name: name, generic_name: "", strength: p.strength, adopted: true, product_key: p.product_key ?? name }], D);
  out.push({ general: g, product: name, form, yj: p.yj_code, result: m.best ? "選ぶ" : m.candidates.length ? "候補" : "なし" });
}
console.log(JSON.stringify(out));
