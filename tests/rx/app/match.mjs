// 使い方：node match.mjs <リポジトリ> <施設マスタ.json> '<[[名前, 規格], ...] の JSON>'
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
const out = JSON.parse(queries).map(([name, strength]) => {
  const m = matchTablet(name, strength ?? null);
  return { name, best: m.best?.id ?? null, bestAdopted: m.best?.adopted ?? null, candidates: m.candidates.map((c) => c.id), substituted: m.substituted };
});
console.log(JSON.stringify(out));
