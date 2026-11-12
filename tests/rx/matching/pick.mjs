// 手で選ぶ流れを lib だけで動かす（画面と同じ順）：explainCandidate → needsOverrideRecord → buildRuleOverrideRecord（overrideRule）→ pickRowState
// node pick.mjs <リポジトリ> '<[{ rx, strength, product, adopted, discontinued_reason, nameNote, reason, changed_by }, ...]>'
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [root, q] = process.argv.slice(2);
const { MATCH_DATA: D } = await import(pathToFileURL(path.join(root, "lib/match-data.ts")).href);
const M = await import(pathToFileURL(path.join(root, "lib/matching.ts")).href);
const P = await import(pathToFileURL(path.join(root, "lib/pick.ts")).href);
const pm = JSON.parse(fs.readFileSync(path.join(root, "data/parent/parent-master.json"), "utf8")).products;
const out = JSON.parse(q).map((c) => {
  const p = pm.find((x) => x.brand_name === c.product);
  const product = { id: p.brand_name, brand_name: p.brand_name, generic_name: "", strength: p.strength, adopted: c.adopted ?? true, discontinued_reason: c.discontinued_reason ?? null, product_key: p.product_key ?? p.brand_name };
  const ex = M.explainCandidate(c.rx, c.strength, product, D, { nameNote: c.nameNote ?? null });
  const needs = P.needsOverrideRecord(ex.kind);
  let record = null, error = null;
  if (needs) {
    try { record = M.buildRuleOverrideRecord({ name_as_written: c.rx, product, rule: P.overrideRule(ex), reason: c.reason ?? "", changed_by: c.changed_by ?? "", at: new Date("2026-11-12T00:00:00Z") }); }
    catch (e) { error = String(e.message ?? e); }
  }
  // 画面と同じく、記録が要るのに作れなければ選ばない
  const picked = !needs || !!record;
  const state = picked ? P.pickRowState(product, ex) : null;
  const again = picked ? P.pickRowState(product, ex) : null;
  return { ...c, ex, needs, record, error, picked, state, idempotent: JSON.stringify(state) === JSON.stringify(again) };
});
console.log(JSON.stringify({ out, cleared: P.pickRowState(null, null), noEx: P.pickRowState({ adopted: true, discontinued_reason: null }, null), labels: { OTHER_DRUG_LABEL: P.OTHER_DRUG_LABEL, OTHER_DRUG_RULE: P.OTHER_DRUG_RULE }, kinds: ["auto", "candidate", "ruleOut", "discontinued", "other"].map((k) => P.needsOverrideRecord(k)) }));
