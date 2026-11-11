// 使い方：node pair.mjs <リポジトリ> '<[[処方の名前, 規格, 施設の採用品の販売名（1 つ。配列なら複数）, options], ...] の JSON>'
// 施設＝渡した採用品だけ（親マスタの製品から作る）で lib/matching.ts の matchRx を呼び、結果を JSON で出す
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [root, q] = process.argv.slice(2);
const { MATCH_DATA: D } = await import(pathToFileURL(path.join(root, "lib/match-data.ts")).href);
const { matchRx, prescribedKeys, facilityOrigin } = await import(pathToFileURL(path.join(root, "lib/matching.ts")).href);
const pm = JSON.parse(fs.readFileSync(path.join(root, "data/parent/parent-master.json"), "utf8")).products;
const product = (name) => {
  const p = pm.find((x) => x.brand_name === name);
  if (!p) throw new Error(`親マスタに無い: ${name}`);
  return { id: p.brand_name, brand_name: p.brand_name, generic_name: "", strength: p.strength, adopted: true, product_key: p.product_key ?? p.brand_name, yj_code: p.yj_code };
};
const out = JSON.parse(q).map(([name, strength, fac, options]) => {
  const facility = (Array.isArray(fac) ? fac : [fac]).map(product);
  const m = matchRx(name, strength, facility, D, options ?? {});
  return {
    name, best: m.best?.id ?? null, candidates: m.candidates.map((c) => c.id), status: m.status, note: m.note,
    ruleOut: m.ruleOut.map((r) => [r.product.id, r.rule]), origin: prescribedKeys(name, strength, null, D).origin, facilityOrigin: facility.map((f) => facilityOrigin(f, D)),
  };
});
console.log(JSON.stringify(out));
