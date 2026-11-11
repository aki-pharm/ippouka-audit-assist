// 同じ薬の鍵に、規格の違う製品が混ざっていないか（品質の読み方：規格の文字の数を全部取り出して比べる）。
// 「1錠中○○10mg」の書き方をそろえた製品（0e449e1）も含めて全部の鍵を見る。node strength-merge.mjs <リポジトリ>
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
const { MATCH_DATA: D } = await import(pathToFileURL(path.join(ROOT, "lib/match-data.ts")).href);
const pm = new Map(JSON.parse(fs.readFileSync(path.join(ROOT, "data/parent/parent-master.json"), "utf8")).products.map((p) => [p.brand_name, p]));
const nk = (s) => String(s ?? "").normalize("NFKC").replace(/[\s　]/g, "");
// 数と単位（mg・μg・g・単位・mEq）。単位の無い数（「1錠中」の 1 など）は数えない
const amounts = (s) => (nk(s).replace(/µ/g, "μ").match(/\d+(?:\.\d+)?(?:mg|μg|g|単位|mEq)/g) ?? []).map((x) => x.replace(/(\d+)\.0+(?=\D)/, "$1").replace(/(\.\d*?)0+(?=\D)/, "$1")).sort().join("+");
const byKey = new Map();
const oneIng = [];
for (const [name, ki] of D.products) {
  const p = pm.get(name);
  if (!p) continue;
  if (/^1(錠|カプセル)中/.test(nk(p.strength))) oneIng.push(`${name}：${p.strength}`);
  const k = D.keys[ki];
  if (!byKey.has(k)) byKey.set(k, new Map());
  const a = amounts(p.strength) || `（数なし:${nk(p.strength)}）`;
  byKey.get(k).set(a, [...(byKey.get(k).get(a) ?? []), name]);
}
const mixed = [];
for (const [k, m] of byKey) {
  const real = [...m.keys()].filter((a) => !a.startsWith("（"));
  if (real.length > 1) mixed.push(`${k}：${[...m].map(([a, ns]) => `${a}=${ns.slice(0, 2).join("、")}${ns.length > 2 ? "…" : ""}`).join(" ／ ")}`);
}
console.log(JSON.stringify({ oneIngredient: oneIng, mixed }));
