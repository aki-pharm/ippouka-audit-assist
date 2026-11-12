// 見分け注意の決まり（lib/lookalike.ts）を品質が試す：数値の余裕（当てはめすぎでないか）と、main の決まりとの違い。
// node --no-warnings sens.mjs <リポジトリ> → JSON
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
const setup = await import(pathToFileURL(path.join(ROOT, "tests/maker/_setup.mjs")).href);
const la = await setup.imp("lib/lookalike.ts");
const pk = await setup.imp("lib/packing.ts");
const oldPk = setup.MAIN_ROOT ? await setup.impMain("lib/packing.ts") : null;
const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
const pm = read("data/parent/parent-master.json").products;
const byKey = new Map(pm.map((p) => [p.product_key, p]));
const pairs = read("data/lookalike-pairs.json");
const P0 = la.LOOKALIKE_PARAMS;
const E = 1e-9;
const out = { params: P0 };

// 1. 拾いたい組（positives）・拾わなくてよい組（negatives）の、それぞれの欄の差と数値までの余裕
const diff = (x, y) => (x == null || y == null ? null : Math.round(Math.abs(x - y) * 1000) / 1000);
const feat = (a, b) => ({ shape: a.shape === b.shape, dE: la.colorDelta(a.color, b.color), long: diff(a.size_long_mm, b.size_long_mm), short: a.shape === "round" ? null : diff(a.size_short_mm, b.size_short_mm), thick: diff(a.thickness_mm, b.thickness_mm) });
const describe = (x) => {
  const A = byKey.get(x.a), B = byKey.get(x.b);
  const f = feat(A, B);
  return { a: x.a, b: x.b, colors: [A.color, B.color], sizes: [[A.size_long_mm, A.size_short_mm, A.thickness_mm], [B.size_long_mm, B.size_short_mm, B.thickness_mm]], ...f, dE: f.dE == null ? null : Math.round(f.dE * 10) / 10,
    margin: { dE: f.dE == null ? null : f.dE === Infinity ? -1e9 /* 片方だけ斑点（JSON に Infinity は書けない） */ : Math.round((P0.maxColorDelta - f.dE) * 10) / 10, long: f.long == null ? null : Math.round((P0.maxLongDiff - f.long) * 100) / 100, short: f.short == null ? null : Math.round((P0.maxShortDiff - f.short) * 100) / 100, thick: f.thick == null ? null : Math.round((P0.maxThickDiff - f.thick) * 100) / 100 } };
};
out.positives = pairs.positives.map(describe);
out.negatives = pairs.negatives.map(describe);
out.colorSame = pairs.color_same.map(([a, b]) => ({ a, b, dE: Math.round(la.colorDelta(a, b) * 10) / 10 }));
out.colorDifferent = pairs.color_different.map(([a, b]) => ({ a, b, dE: Math.round(la.colorDelta(a, b) * 10) / 10 }));

// 2. 1 つずつ 0.1mm（色は ΔE 1）締める・緩める
const STEPS = { maxLongDiff: 0.1, maxShortDiff: 0.1, maxThickDiff: 0.1, maxColorDelta: 1 };
const variants = [];
for (const [k, st] of Object.entries(STEPS)) for (const sign of [-1, 1]) variants.push({ name: `${k}${sign < 0 ? "-" : "+"}${st}`, p: { ...P0, [k]: Math.round((P0[k] + sign * st) * 100) / 100 } });
const hit = (x, p) => la.lookAlike(byKey.get(x.a), byKey.get(x.b), p).similar;

// 全体の割合：親マスタの錠剤（scripts/eval/lookalike.cjs と同じ選び方）の、すべての 2 錠の組
const tablets = pm.filter((p) => /錠/.test(p.brand_name) && !/カプセル/.test(p.brand_name) && p.shape && p.color && p.color !== "未確認");
const cd = new Map();
const delta = (a, b) => { const k = a < b ? `${a}\0${b}` : `${b}\0${a}`; if (!cd.has(k)) cd.set(k, la.colorDelta(a, b)); return cd.get(k); };
const raw = (c) => (c ?? "").normalize("NFKC").replace(/[\s　]/g, "");
const feats = [];
let total = 0, oldHits = 0;
const oldKey = (c) => { const n = c.replace(/[\s　]/g, ""); if (/^白|^微黄白|^帯黄白|^淡黄白/.test(n)) return "white"; if (/^淡黄|^黄/.test(n)) return "yellow"; if (/^淡赤|^淡紅|^桃|^赤|^うす赤/.test(n)) return "pink"; if (/^橙|^淡橙|^だいだい/.test(n)) return "orange"; return n; };
const dz = (x, y) => (x == null || y == null ? 0 : Math.abs(x - y));
for (let i = 0; i < tablets.length; i++) for (let j = i + 1; j < tablets.length; j++) {
  total++;
  const a = tablets[i], b = tablets[j];
  if (a.shape !== b.shape) continue;
  if (oldKey(a.color) === oldKey(b.color) && dz(a.size_long_mm, b.size_long_mm) <= 1.0) oldHits++;
  const d = delta(a.color, b.color) ?? (raw(a.color) === raw(b.color) ? 0 : null);
  if (d == null) continue;
  feats.push([d, dz(a.size_long_mm, b.size_long_mm), a.shape === "round" ? 0 : dz(a.size_short_mm, b.size_short_mm), dz(a.thickness_mm, b.thickness_mm)]);
}
const rate = (p) => { let n = 0; for (const [d, l, s, t] of feats) if (d <= p.maxColorDelta && l <= p.maxLongDiff + E && s <= p.maxShortDiff + E && t <= p.maxThickDiff + E) n++; return n / total; };
out.population = { tablets: tablets.length, pairs: total, oldRate: oldHits / total, rate: rate(P0) };
out.variants = variants.map(({ name, p }) => ({
  name, params: p, rate: rate(p),
  positivesLost: pairs.positives.filter((x) => !hit(x, p)).map((x) => `${x.a} ／ ${x.b}`),
  negativesHit: pairs.negatives.filter((x) => hit(x, p)).map((x) => `${x.a} ／ ${x.b}`),
  colorSameBroken: pairs.color_same.filter(([a, b]) => la.colorDelta(a, b) > p.maxColorDelta).map((x) => x.join("／")),
  colorDifferentBroken: pairs.color_different.filter(([a, b]) => la.colorDelta(a, b) <= p.maxColorDelta).map((x) => x.join("／")),
}));

// 3. 見本（public/samples）と rx-testset の処方で、main で見分け注意だった同じ袋の組のうち、新しい決まりで外れた組
const TIM = ["morning", "noon", "evening"];
const asTablet = (p) => ({ ...p, id: p.product_key, dosage_form: /錠/.test(p.brand_name) && !/カプセル/.test(p.brand_name) ? "tablet" : "capsule" });
function compareBag(where, tabs) {
  const ent = tabs.map((t) => ({ tablet: t }));
  const pairsIn = (groups) => { const s = new Set(); for (const g of groups) for (const x of g.tablet_ids) for (const y of g.tablet_ids) if (x < y) s.add(`${x}\0${y}`); return s; };
  const o = pairsIn(oldPk.findSimilar(ent)), nw = pairsIn(pk.findSimilar(ent));
  const res = { lost: [], gained: [] };
  const byId = new Map(tabs.map((t) => [t.id, t]));
  const show = (k) => { const [x, y] = k.split("\0"); const A = byId.get(x), B = byId.get(y); const f = feat(A, B);
    return { where, a: x, b: y, a_look: `${A.shape} ${A.color} ${A.size_long_mm ?? "?"}×${A.size_short_mm ?? "?"}×${A.thickness_mm ?? "?"}mm`, b_look: `${B.shape} ${B.color} ${B.size_long_mm ?? "?"}×${B.size_short_mm ?? "?"}×${B.thickness_mm ?? "?"}mm`,
      dE: f.dE == null ? null : Math.round(f.dE * 10) / 10, long: f.long, short: f.short, thick: f.thick, why: la.lookAlike(A, B).why, similarNow: la.lookAlike(A, B).similar,
      // main で 2 錠が直接似ていたか（false なら、ほかの錠を介した鎖で同じ組になっていただけ）
      oldDirect: A.shape === B.shape && oldKey(A.color) === oldKey(B.color) && (A.size_long_mm == null || B.size_long_mm == null || Math.abs(A.size_long_mm - B.size_long_mm) <= 1.0) }; };
  for (const k of o) if (!nw.has(k)) res.lost.push(show(k));
  for (const k of nw) if (!o.has(k)) res.gained.push(show(k));
  return res;
}
out.bags = { compared: 0, oldPairs: 0, newPairs: 0, lost: [], gained: [] };
const add = (where, tabs) => {
  const uniq = [...new Map(tabs.filter(Boolean).map((t) => [t.id, t])).values()];
  if (uniq.length < 2 || !oldPk) return;
  out.bags.compared++;
  const r = compareBag(where, uniq);
  out.bags.lost.push(...r.lost); out.bags.gained.push(...r.gained);
};
// 見本：buildBags（施設マスタの錠剤）
const mf = await setup.imp("lib/master.ts");
for (const { name, rx } of setup.samples()) {
  const rows = pk.toRows(rx);
  for (const b of pk.buildBags(rows)) add(`${name} ${b.timing}`, b.entries.map((e) => e.tablet));
}
// rx-testset：期待の採用品（expected-adopted.csv の expected）を親マスタの製品に当てる
const csv = fs.readFileSync(path.join(ROOT, "data/rx-testset/expected-adopted.csv"), "utf8").trim().split("\n").slice(1).map((l) => l.split(","));
const adopted = new Map(csv.map(([rx, rp, , expected]) => [`${rx}|${rp}`, expected]));
for (const f of fs.readdirSync(path.join(ROOT, "data/rx-testset/expected")).sort()) {
  const id = f.replace(".expected.json", "");
  const rx = read(`data/rx-testset/expected/${f}`);
  for (const t of TIM) {
    const tabs = rx.items.filter((it) => it.per_timing?.[t] > 0).map((it) => byKey.get(adopted.get(`${id}|${it.rp}`))).filter(Boolean).map(asTablet);
    add(`${id} ${t}`, tabs);
  }
}
const dedupe = (xs) => [...new Map(xs.map((x) => [`${x.a}\0${x.b}`, x])).values()];
out.bags.lostUnique = dedupe(out.bags.lost);
out.bags.gainedUnique = dedupe(out.bags.gained);
console.log(JSON.stringify(out));
