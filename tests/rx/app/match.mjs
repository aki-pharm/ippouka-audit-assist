// 使い方：node match.mjs <リポジトリ> <施設マスタ.json> '<[[名前, 規格, 照合の options（任意）], ...] の JSON>'
// アプリの matchTablet の結果（best の id、候補の id、substituted）を JSON で出す
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

const [root, facilityFile, queries] = process.argv.slice(2);
const raw = JSON.parse(fs.readFileSync(facilityFile, "utf8"));
const facility = (Array.isArray(raw) ? raw : raw.products).map((p) => ({ ...p, id: p.id ?? p.brand_name }));
register(new URL("./hooks.mjs", import.meta.url), { data: { facility } });
const { matchTablet } = await import(pathToFileURL(path.join(root, "lib/master.ts")).href);
const out = JSON.parse(queries).map(([name, strength, options]) => {
  const m = matchTablet(name, strength ?? null, options ?? {});
  return {
    name, best: m.best?.id ?? null, bestAdopted: m.best?.adopted ?? null, candidates: m.candidates.map((c) => c.id), substituted: m.substituted,
    // feature/matching-rules で足した欄（無ければ undefined）
    status: m.status, note: m.note ?? null, previous: (m.previous ?? []).map((p) => p.id), ruleOut: (m.ruleOut ?? []).map((r) => [r.product.id, r.rule]),
  };
});
console.log(JSON.stringify(out));
