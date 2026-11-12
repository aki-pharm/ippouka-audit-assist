// reports/lookalike-lost.md を作る（AKI の判断用）。sens.mjs の結果を、近い順に並べる。
// node --no-warnings sens.mjs <リポジトリ> | node lost-list.mjs > reports/lookalike-lost.md
let raw = "";
for await (const c of process.stdin) raw += c;
const o = JSON.parse(raw);
const P = o.params;
const n2 = (x) => (x == null ? "?" : String(Number(Number(x).toFixed(2))));
const tag = (w) => w.replace(".expected.json", "（見本）").replace(" morning", " 朝").replace(" noon", " 昼").replace(" evening", " 夕");
// 近さ：大きさ・厚さ・色のそれぞれを数値で割った値の最大（1 以下なら見分け注意）。片方だけ斑点の組は色を除き大きさだけで測る
function score(x) {
  const r = [x.long / P.maxLongDiff, (x.short ?? 0) / P.maxShortDiff, x.thick / P.maxThickDiff];
  const sp = x.speckled[0] !== x.speckled[1];
  if (!sp && x.dE != null) r.push(x.dE / P.maxColorDelta);
  return Math.max(...r.map((v) => v || 0));
}
function decide(x) {
  const sp = x.speckled[0] !== x.speckled[1];
  if (sp) return "片方だけ斑点";
  const out = [];
  if (x.dE > P.maxColorDelta) out.push(`色 ΔE ${x.dE}`);
  if (x.long > P.maxLongDiff + 1e-9) out.push(`長径の差 ${n2(x.long)}mm`);
  if (x.short != null && x.short > P.maxShortDiff + 1e-9) out.push(`短径の差 ${n2(x.short)}mm`);
  if (x.thick > P.maxThickDiff + 1e-9) out.push(`厚さの差 ${n2(x.thick)}mm`);
  return out.join("・");
}
const look = (s) => s.replace(/^round /, "丸 ").replace(/^oval /, "楕円 ").replace(/^oblong /, "長円 ");
const where = (list, x) => [...new Set(list.filter((y) => [y.a, y.b].sort().join() === [x.a, x.b].sort().join()).map((y) => tag(y.where)))].join("、");
const lost = o.bags.lostUnique.map((x) => ({ ...x, s: score(x) })).sort((a, b) => a.s - b.s);
const gained = o.bags.gainedUnique.map((x) => ({ ...x, s: score(x) })).sort((a, b) => a.s - b.s);
const L = [];
L.push("# 見分け注意：main の決まりから変わった同じ袋の組（AKI の判断用）", "");
L.push(`今の決まり：同じ形・色の差 ΔE ${P.maxColorDelta} 以内・長径の差 ${P.maxLongDiff}mm 以内・短径の差 ${P.maxShortDiff}mm 以内（丸以外）・厚さの差 ${P.maxThickDiff}mm 以内。片方だけ斑点がある組は見分け注意にしない。`);
L.push(`main の決まり：同じ形・同じ色の系統（白〜微黄白など）・長径の差 1.0mm 以内（厚さは見ない。似た錠を鎖でつなぐ）。`);
L.push(`比べた袋：見本 3 枚と rx-testset 20 枚の ${o.bags.compared} 袋（rx-testset は期待の採用品を親マスタに当てた）。`, "");
L.push("「近さ」は、差を今の数値で割った値のいちばん大きいもの（1.00 以下なら見分け注意）。片方だけ斑点の組は大きさ・厚さだけで測った。上ほど近い＝見分け注意に戻すか考える価値が高い。", "");
L.push(`## 外れた組 ${lost.length}（main では見分け注意、今は付かない）`, "");
L.push("| 近さ | 決め手 | 錠 A | 錠 B | 処方 |", "|---|---|---|---|---|");
for (const x of lost) L.push(`| ${x.s.toFixed(2)} | ${decide(x)}${x.oldDirect ? "" : "（main でも鎖だけ）"} | ${x.a_name}<br>${look(x.a_look)} | ${x.b_name}<br>${look(x.b_look)} | ${where(o.bags.lost, x)} |`);
L.push("", `## 新しく付いた組 ${gained.length}（main では付かず、今は見分け注意）`, "");
L.push("| 近さ | 錠 A | 錠 B | 差 | 処方 |", "|---|---|---|---|---|");
for (const x of gained) L.push(`| ${x.s.toFixed(2)} | ${x.a_name}<br>${look(x.a_look)} | ${x.b_name}<br>${look(x.b_look)} | ΔE ${x.dE}・長径 ${n2(x.long)}mm・厚さ ${n2(x.thick)}mm | ${where(o.bags.gained, x)} |`);
L.push("", "作り方：`node --no-warnings tests/rx/lookalike/sens.mjs . | node tests/rx/lookalike/lost-list.mjs > reports/lookalike-lost.md`（品質）");
console.log(L.join("\n"));
