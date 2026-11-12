// lib/rxFix.ts を動かす（品質の試験用）。node run.mjs <リポジトリ> names '<["名前", ...]>' → [規格|null, ...]
//                                          node run.mjs <リポジトリ> fill '<RxReadResult の JSON>' → { result, filled, original（呼んだあとの元の値） }
//                                          node run.mjs <リポジトリ> parent → 親マスタ（照合のデータにある製品）全部で、名前から取った規格と親マスタの規格
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [root, mode, arg] = process.argv.slice(2);
const { strengthFromName, fillStrengthFromName } = await import(pathToFileURL(path.join(root, "lib/rxFix.ts")).href);
if (mode === "names") console.log(JSON.stringify(JSON.parse(arg).map((n) => strengthFromName(n))));
else if (mode === "fill") {
  const input = JSON.parse(arg);
  const before = JSON.stringify(input);
  const out = fillStrengthFromName(input);
  console.log(JSON.stringify({ ...out, mutated: JSON.stringify(input) !== before }));
} else if (mode === "parent") {
  const { MATCH_DATA: D } = await import(pathToFileURL(path.join(root, "lib/match-data.ts")).href);
  const inData = new Set(D.products.map(([n]) => n));
  const pm = JSON.parse(fs.readFileSync(path.join(root, "data/parent/parent-master.json"), "utf8")).products.filter((p) => inData.has(p.brand_name));
  console.log(JSON.stringify(pm.map((p) => [p.brand_name, p.strength, strengthFromName(p.brand_name)])));
}
