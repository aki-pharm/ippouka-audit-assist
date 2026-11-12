#!/usr/bin/env node
/**
 * 見分け注意の決まり（lib/lookalike.ts）の数値を選ぶ。
 *   node scripts/eval/lookalike.cjs [--pairs 200000] [--json]
 * data/lookalike-pairs.json の positives（見分け注意にしたい組）をすべて拾い、negatives（しなくてよい組）を 1 つも拾わず、
 * color_same（同じに見える色）を同じ、color_different（違って見える色）を違うとする数値のうち、
 * 親マスタの錠剤から無作為に作った「同じ袋の組」で見分け注意になる割合がいちばん低いものを選ぶ（同じなら数値の大きい＝余裕のある方）。
 * 前の決まり（同じ形・同じ色の系統・長径の差 1.0mm 以内）の割合も並べて出す。
 */
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..", "..");
const args = process.argv.slice(2);
const N = Number(args[args.indexOf("--pairs") + 1]) || 200000;
const asJson = args.includes("--json");

/** 前の決まり（lib/packing.ts の colorKey と findSimilar の判定） */
function oldColorKey(c) {
  const n = c.replace(/[\s　]/g, "");
  if (/^白|^微黄白|^帯黄白|^淡黄白/.test(n)) return "white";
  if (/^淡黄|^黄/.test(n)) return "yellow";
  if (/^淡赤|^淡紅|^桃|^赤|^うす赤/.test(n)) return "pink";
  if (/^橙|^淡橙|^だいだい/.test(n)) return "orange";
  return n;
}
const oldSimilar = (a, b) =>
  a.shape === b.shape && oldColorKey(a.color) === oldColorKey(b.color) && (a.size_long_mm == null || b.size_long_mm == null || Math.abs(a.size_long_mm - b.size_long_mm) <= 1.0);

/** 決まった種から作る乱数（毎回同じ組になる） */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

async function main() {
  const { lookAlike, colorDelta, LOOKALIKE_PARAMS } = await import(pathToFileURL(path.join(ROOT, "lib/lookalike.ts")).href);
  const pm = JSON.parse(fs.readFileSync(path.join(ROOT, "data/parent/parent-master.json"), "utf8")).products;
  const pairsFile = JSON.parse(fs.readFileSync(path.join(ROOT, "data/lookalike-pairs.json"), "utf8"));
  const byKey = new Map(pm.map((p) => [p.product_key, p]));
  const resolve = (k) => {
    const p = byKey.get(k);
    if (!p) throw new Error(`親マスタに無い製品：${k}`);
    return p;
  };
  const pos = pairsFile.positives.map((x) => ({ ...x, A: resolve(x.a), B: resolve(x.b) }));
  const neg = pairsFile.negatives.map((x) => ({ ...x, A: resolve(x.a), B: resolve(x.b) }));

  // 同じ袋に入りうる錠剤（カプセルは見分け注意の対象外。形と色が分かるもの）
  const tablets = pm.filter((p) => /錠/.test(p.brand_name) && !/カプセル/.test(p.brand_name) && p.shape && p.color && p.color !== "未確認");
  const rand = rng(20261112);
  const sample = [];
  while (sample.length < N) {
    const i = Math.floor(rand() * tablets.length);
    const j = Math.floor(rand() * tablets.length);
    if (i !== j) sample.push([tablets[i], tablets[j]]);
  }
  // 組ごとの差を 1 回だけ計算しておく（形が同じで色が読める組だけ。分からない大きさ・厚さは差 0＝その欄では外さない）
  const cd = new Map();
  const delta = (a, b) => {
    const k = `${a}\u0000${b}`;
    if (!cd.has(k)) cd.set(k, colorDelta(a, b));
    return cd.get(k);
  };
  const diff = (x, y) => (x == null || y == null ? 0 : Math.abs(x - y));
  const feats = [];
  for (const [a, b] of sample) {
    if (!a.shape || a.shape !== b.shape) continue;
    const raw = (c) => (c ?? "").normalize("NFKC").replace(/[\s　]/g, "");
    const d = delta(a.color, b.color) ?? (raw(a.color) && raw(a.color) === raw(b.color) ? 0 : null); // lib/lookalike.ts と同じ（読めない色は同じ言い方どうしだけ同じ）
    if (d == null) continue;
    feats.push([d, diff(a.size_long_mm, b.size_long_mm), a.shape === "round" ? 0 : diff(a.size_short_mm, b.size_short_mm), diff(a.thickness_mm, b.thickness_mm)]);
  }
  const E = 1e-9;
  const flagRate = (p) => {
    let n = 0;
    for (const [d, l, sh, t] of feats) if (d <= p.maxColorDelta && l <= p.maxLongDiff + E && sh <= p.maxShortDiff + E && t <= p.maxThickDiff + E) n++;
    return n / sample.length;
  };
  const oldRate = sample.filter(([a, b]) => oldSimilar(a, b)).length / sample.length;

  const ok = (p) =>
    pos.every((x) => lookAlike(x.A, x.B, p).similar) &&
    neg.every((x) => !lookAlike(x.A, x.B, p).similar) &&
    pairsFile.color_same.every(([a, b]) => (colorDelta(a, b) ?? Infinity) <= p.maxColorDelta) &&
    pairsFile.color_different.every(([a, b]) => (colorDelta(a, b) ?? 0) > p.maxColorDelta);

  const range = (a, b, step) => Array.from({ length: Math.round((b - a) / step) + 1 }, (_, i) => Math.round((a + i * step) * 100) / 100);
  const grid = [];
  for (const maxLongDiff of range(0.3, 2.0, 0.1))
    for (const maxShortDiff of [0.5, 1.0, 1.5, Infinity])
      for (const maxThickDiff of [...range(0.2, 1.5, 0.1), Infinity])
        for (const maxColorDelta of range(8, 40, 2)) {
          const p = { maxLongDiff, maxShortDiff, maxThickDiff, maxColorDelta };
          if (ok(p)) grid.push(p);
        }
  // 条件を満たす数値の中で、割合のいちばん低いもの（同じなら数値の大きいもの）
  let best = null;
  for (const p of grid) {
    const rate = flagRate(p);
    const margin = p.maxLongDiff + p.maxThickDiff + p.maxColorDelta / 10 + (p.maxShortDiff === Infinity ? 9 : p.maxShortDiff);
    if (!best || rate < best.rate - 1e-12 || (Math.abs(rate - best.rate) <= 1e-12 && margin > best.margin)) best = { p, rate, margin };
  }
  const show = (p) => ({
    positives: pos.map((x) => ({ a: x.a, b: x.b, hit: lookAlike(x.A, x.B, p).similar, why: lookAlike(x.A, x.B, p).why })),
    negatives: neg.map((x) => ({ a: x.a, b: x.b, hit: lookAlike(x.A, x.B, p).similar, why: lookAlike(x.A, x.B, p).why })),
  });
  const oldShow = {
    positives: pos.map((x) => ({ a: x.a, b: x.b, hit: oldSimilar(x.A, x.B) })),
    negatives: neg.map((x) => ({ a: x.a, b: x.b, hit: oldSimilar(x.A, x.B) })),
  };
  const out = {
    tablets: tablets.length,
    sample_pairs: sample.length,
    old_rule: { rate: oldRate, ...oldShow },
    current_params: { params: LOOKALIKE_PARAMS, rate: flagRate(LOOKALIKE_PARAMS), ok: ok(LOOKALIKE_PARAMS), ...show(LOOKALIKE_PARAMS) },
    candidates_ok: grid.length,
    best: best && { params: best.p, rate: best.rate, ...show(best.p) },
  };
  if (asJson) return console.log(JSON.stringify(out, null, 2));
  const pct = (r) => `${(r * 100).toFixed(2)}%`;
  const line = (r) => `${r.hit ? "○" : "×"} ${r.a} ／ ${r.b}${r.why ? `（${r.why}）` : ""}`;
  console.log(`親マスタの錠剤 ${out.tablets}、無作為の組 ${out.sample_pairs}`);
  console.log(`\n前の決まり：見分け注意になる割合 ${pct(oldRate)}`);
  console.log(" 拾ってほしい組：", oldShow.positives.map((r) => (r.hit ? "○" : "×")).join(""), " 拾わなくてよい組：", oldShow.negatives.map((r) => (r.hit ? "○" : "×")).join(""));
  console.log(`\n今の数値 ${JSON.stringify(LOOKALIKE_PARAMS)}：割合 ${pct(out.current_params.rate)}、条件を${out.current_params.ok ? "満たす" : "満たさない"}`);
  for (const r of out.current_params.positives) console.log("  拾う  ", line(r));
  for (const r of out.current_params.negatives) console.log("  拾わない", line(r));
  console.log(`\n条件を満たす数値 ${grid.length} 通り。いちばん割合の低いもの：${best ? `${JSON.stringify(best.p)} ${pct(best.rate)}` : "なし"}`);
  if (best && JSON.stringify(best.p) !== JSON.stringify(LOOKALIKE_PARAMS))
    console.log(`※ lib/lookalike.ts の LOOKALIKE_PARAMS は、これに余裕を足した数値（割合 ${pct(out.current_params.rate)}。差 ${pct(out.current_params.rate - best.rate)}）`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
