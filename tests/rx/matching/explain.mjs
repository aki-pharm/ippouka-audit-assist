// lib/matching.ts の explainCandidate（画面の一覧の札）と buildRuleOverrideRecord（札のある製品を選ぶときの記録）を呼ぶ。
// node explain.mjs <リポジトリ> explain '<[[処方の名前, 規格, 採用品の販売名, { adopted, discontinued_reason, nameNote }], ...]>'
// node explain.mjs <リポジトリ> record '<[{ name_as_written, product, rule, reason, changed_by }, ...]>' → [{ record } | { error }]
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [root, mode, q] = process.argv.slice(2);
const { MATCH_DATA: D } = await import(pathToFileURL(path.join(root, "lib/match-data.ts")).href);
const { explainCandidate, buildRuleOverrideRecord } = await import(pathToFileURL(path.join(root, "lib/matching.ts")).href);
const pm = JSON.parse(fs.readFileSync(path.join(root, "data/parent/parent-master.json"), "utf8")).products;
const product = (name, o = {}) => {
  const p = pm.find((x) => x.brand_name === name);
  if (!p) throw new Error(`親マスタに無い: ${name}`);
  return { id: p.brand_name, brand_name: p.brand_name, generic_name: "", strength: p.strength, adopted: o.adopted ?? true, discontinued_reason: o.discontinued_reason ?? null, product_key: p.product_key ?? p.brand_name };
};
if (mode === "explain") {
  console.log(JSON.stringify(JSON.parse(q).map(([name, strength, fac, o = {}]) => ({ name, fac, ...explainCandidate(name, strength, product(fac, o), D, { nameNote: o.nameNote ?? null }) }))));
} else {
  console.log(JSON.stringify(JSON.parse(q).map((a) => {
    try { return { record: buildRuleOverrideRecord({ ...a, product: product(a.product), at: new Date("2026-11-12T00:00:00Z") }) }; }
    catch (e) { return { error: String(e.message ?? e) }; }
  })));
}
