// 事前合意（options.agreements）を渡して matchRx を呼ぶ。node agree.mjs <リポジトリ> '<[[処方の名前, 規格, 採用品の販売名, agreements, options], ...]>'
// 例外で落ちたら { error } を返す（落ちること自体を記録する）
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [root, q] = process.argv.slice(2);
const { MATCH_DATA: D } = await import(pathToFileURL(path.join(root, "lib/match-data.ts")).href);
const { matchRx } = await import(pathToFileURL(path.join(root, "lib/matching.ts")).href);
const pm = JSON.parse(fs.readFileSync(path.join(root, "data/parent/parent-master.json"), "utf8")).products;
const product = (name) => {
  const p = pm.find((x) => x.brand_name === name);
  if (!p) throw new Error(`親マスタに無い: ${name}`);
  return { id: p.brand_name, brand_name: p.brand_name, generic_name: "", strength: p.strength, adopted: true, product_key: p.product_key ?? p.brand_name };
};
const out = JSON.parse(q).map(([name, strength, fac, agreements, options]) => {
  try {
    const m = matchRx(name, strength, [product(fac)], D, { ...(options ?? {}), agreements });
    return { name, fac, best: m.best?.id ?? null, candidates: m.candidates.map((c) => c.id), note: m.note, agreement: m.agreement ?? null };
  } catch (e) {
    return { name, fac, error: String(e.message ?? e).slice(0, 200) };
  }
});
console.log(JSON.stringify(out));
