// lib/lookalike.ts（見分け注意の決まり）を品質が試す。data/lookalike-pairs.json の組に当てはめすぎていないか（数値を 0.1mm・ΔE 1 動かしたとき）と、
// main の決まりから外れた同じ袋の組（AKI の判断用）。数値の良し悪しは AKI が決める。ここでは事実を出し、決まりと札の食い違いだけを落とす。
//   node --test tests/rx/
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { ROOT } = require("./helpers.cjs");

const tsOk = Number(process.versions.node.split(".")[0]) >= 22 && process.features?.typescript;
const skip = !tsOk && "Node の TypeScript 読み込みが無い";
let cache;
const run = () => {
  if (cache) return cache;
  const r = spawnSync(process.execPath, ["--no-warnings", path.join(__dirname, "lookalike/sens.mjs"), ROOT], { encoding: "utf8", maxBuffer: 1 << 28 });
  assert.equal(r.status, 0, r.stderr.slice(0, 300));
  return (cache = JSON.parse(r.stdout));
};
const pct = (r) => `${(r * 100).toFixed(2)}%`;

test("今の数値は、拾いたい組をすべて拾い、拾わなくてよい組を 1 つも拾わない（色の組も合う）", { skip }, (t) => {
  const o = run();
  const within = (x) => x.shape && Object.values(x.margin).every((m) => m == null || m >= -1e-9);
  for (const x of o.positives) assert.ok(within(x), `拾いたい組が外れる：${x.a}／${x.b}`);
  for (const x of o.negatives) assert.ok(!within(x), `拾わなくてよい組を拾う：${x.a}／${x.b}`);
  for (const x of o.colorSame) assert.ok(x.dE <= o.params.maxColorDelta, `${x.a}／${x.b} ΔE ${x.dE}`);
  for (const x of o.colorDifferent) assert.ok(x.dE > o.params.maxColorDelta, `${x.a}／${x.b} ΔE ${x.dE}`);
  t.diagnostic(`拾いたい組の余裕（数値 − 差）：${o.positives.map((x) => `[${x.a}／${x.b}] 長径 ${x.margin.long} 厚さ ${x.margin.thick} ΔE ${x.margin.dE}`).join(" ")}`);
  t.diagnostic(`同じ色の組の ΔE 最大 ${Math.max(...o.colorSame.map((x) => x.dE))}、違う色の組の最小 ${Math.min(...o.colorDifferent.map((x) => x.dE))}（数値 ${o.params.maxColorDelta}）`);
});

test("数値の余裕：拾いたい組すべてで、長径・厚さ・ΔE の数値までの余裕が 0.1mm（ΔE は 1）以上。1 段締めても緩めても、組の結果は変わらない", { skip }, (t) => {
  const o = run();
  t.diagnostic(`親マスタの錠剤 ${o.population.tablets}、すべての 2 錠の組 ${o.population.pairs}：見分け注意の割合 今 ${pct(o.population.rate)}（main の決まり ${pct(o.population.oldRate)}）`);
  for (const x of o.variants) t.diagnostic(`${x.name}：割合 ${pct(x.rate)}、外れる拾いたい組 ${x.positivesLost.length}、拾う拾わなくてよい組 ${x.negativesHit.length}`);
  for (const x of o.positives) {
    for (const k of ["long", "thick"]) if (x.margin[k] != null) assert.ok(x.margin[k] >= 0.1 - 1e-9, `${x.a}／${x.b}：${k} の余裕 ${x.margin[k]}mm`);
    if (x.margin.dE != null) assert.ok(x.margin.dE >= 1, `${x.a}／${x.b}：ΔE の余裕 ${x.margin.dE}`);
  }
  for (const v of o.variants) {
    assert.equal(v.positivesLost.length, 0, `${v.name}：${v.positivesLost.join("、")}`);
    assert.equal(v.negativesHit.length, 0, `${v.name}：${v.negativesHit.join("、")}`);
  }
  // 短径は拾いたい組がすべて丸い錠なので、組からは決まっていない（AKI が楕円の組を足すまで）
  assert.ok(o.positives.every((x) => x.short == null));
});

test("見本と rx-testset の同じ袋：main で見分け注意だったが外れた組は、今の決まりで本当に似ていない（理由つき）。新しく拾った組は今の決まりで似ている", { skip }, (t) => {
  const o = run();
  t.diagnostic(`比べた袋 ${o.bags.compared}、外れた組 ${o.bags.lostUnique.length}（main で直接似ていた ${o.bags.lostUnique.filter((x) => x.oldDirect).length}、鎖でつながっていただけ ${o.bags.lostUnique.filter((x) => !x.oldDirect).length}）、新しく拾った組 ${o.bags.gainedUnique.length}`);
  for (const x of o.bags.lostUnique) {
    assert.equal(x.similarNow, false, `${x.a}／${x.b}`);
    t.diagnostic(`外れた ${x.where}：${x.a}（${x.a_look}）／${x.b}（${x.b_look}）→ ${x.why}${x.oldDirect ? "" : "（main でも鎖だけ）"}`);
  }
  for (const x of o.bags.gainedUnique) {
    assert.equal(x.similarNow, true, `${x.a}／${x.b}`);
    t.diagnostic(`拾った ${x.where}：${x.a}（${x.a_look}）／${x.b}（${x.b_look}）ΔE ${x.dE}`);
  }
  // AKI が「しなくてよい」とした rx-c 夕の 3 組は外れている
  const lost = new Set(o.bags.lostUnique.map((x) => [x.a, x.b].sort().join("/")));
  for (const k of [["darbroc-4", "rivotril-0.5"], ["darbroc-4", "doxazosin-1-towa"], ["doxazosin-1-towa", "rivotril-0.5"]]) assert.ok(lost.has(k.sort().join("/")), k.join("/"));
});

test("reports/lookalike-lost.md（AKI の判断用の一覧）が今の決まりの結果と同じ", { skip }, () => {
  const o = run();
  const r = spawnSync(process.execPath, [path.join(__dirname, "lookalike/lost-list.mjs")], { input: JSON.stringify(o), encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr.slice(0, 300));
  const file = require("node:fs").readFileSync(path.join(ROOT, "reports/lookalike-lost.md"), "utf8");
  assert.equal(file, r.stdout, "一覧が古い。作り方は reports/lookalike-lost.md の末尾");
  assert.equal(o.bags.lostUnique.length, 32);
  assert.equal(o.bags.gainedUnique.length, 3);
});
