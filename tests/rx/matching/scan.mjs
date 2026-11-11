// 親マスタ全体で照合の決まりを確かめる（品質の独立の検査）。node --experimental-strip-types scan.mjs <リポジトリ> [--all]
// 同じ成分（YJ 上 7 桁）・同じ規格の製品どうしを 1 対 1 で組み、施設＝その 1 製品だけ、処方＝もう一方の名前で lib/matching.ts の matchRx を呼ぶ。
// 剤形・放出・先発後発は lib/makers.ts・match-data を使わず、販売名・YJ の 8 桁目・厚労省の一覧（naifuku）から品質が自分で決める。
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
const ALL = process.argv.includes("--all");
const { MATCH_DATA: D } = await import(pathToFileURL(path.join(ROOT, "lib/match-data.ts")).href);
const { matchRx } = await import(pathToFileURL(path.join(ROOT, "lib/matching.ts")).href);
const pm = JSON.parse(fs.readFileSync(path.join(ROOT, "data/parent/parent-master.json"), "utf8")).products.filter((p) => p.status !== "none" && p.yj_code && p.strength);

// 厚労省の一覧：販売名 → 先発・後発
const csvFile = fs.readdirSync(path.join(ROOT, "data/parent")).find((f) => /^naifuku-tablets-.*\.csv$/.test(f));
const parse = (l) => { const o = []; let c = "", q = false; for (const ch of l) { if (q) { if (ch === '"') q = false; else c += ch; } else if (ch === '"') q = true; else if (ch === ",") { o.push(c); c = ""; } else c += ch; } o.push(c); return o; };
const lines = fs.readFileSync(path.join(ROOT, "data/parent", csvFile), "utf8").trim().split("\n");
const head = parse(lines[0]);
const nk = (s) => String(s ?? "").normalize("NFKC").replace(/[\s　]/g, "");
const officialByName = new Map();
const unifiedYj = new Set();
for (const l of lines.slice(1)) {
  const o = Object.fromEntries(head.map((h, i) => [h, parse(l)[i]]));
  officialByName.set(nk(o.brand_name), o);
  if (!o.maker) unifiedYj.add(o.yj_code);
}

// 品質の剤形の読み方（lib/makers.ts とは別に書いた）
const body = (name) => nk(name).replace(/「[^」]*」/g, "").replace(/[（(][^）)]*[）)]/g, "");
const capsule = (p) => /カプセル/.test(p.brand_name) || p.yj_code[7] === "M" || p.yj_code[7] === "N";
// OD の印は data/parent/form-markers.json の od（レディタブなど、作業側が足した印も読む）。英字の印は前が英字でないときだけ
const MARKERS = JSON.parse(fs.readFileSync(path.join(ROOT, "data/parent/form-markers.json"), "utf8"));
const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const odRe = new RegExp(`(${MARKERS.od.map((w) => (/^[A-Za-z]+$/.test(w) ? `(?<![A-Za-z])${esc(w)}` : esc(w))).join("|")})(・)?錠|ODフィルム`);
const od = (p) => odRe.test(body(p.brand_name));
function release(p) {
  const b = body(p.brand_name);
  const m = b.match(/(CR|SR|TR|LA|XR|ER|XL|L|R|U|EN)(錠|カプセル)/);
  if (m) return m[1] === "EN" ? "腸溶" : m[1];
  if (/徐放|持続/.test(b)) return "徐放";
  if (/腸溶/.test(b)) return "腸溶";
  const c = p.yj_code[7];
  if (c === "G" || c === "N") return "徐放(YJ)";
  if (c === "H") return "腸溶(YJ)";
  return "";
}
const relKind = (r) => (r === "" ? "普通" : /徐放/.test(r) || /^(CR|SR|TR|LA|XR|ER|XL|L|R|U)$/.test(r) ? `徐放:${r}` : r);
const strengthNorm = (s) => nk(s).toLowerCase().replace(/ｍｇ/g, "mg").replace(/µ/g, "μ").replace(/(\d+)\.0+(?=\D|$)/, "$1");
const generic = (p) => /「[^」]+」/.test(nk(p.brand_name));
function brandLike(p) {
  const o = officialByName.get(nk(p.brand_name));
  if (o) return o.is_original === "True";
  // 一覧に名前が無く、YJ が統一名（メーカーの無い行）を指す「」の無い製品（パキシル錠など）は先発とみなす
  return !generic(p) && unifiedYj.has(p.yj_code);
}

// 組を作る：成分（YJ 上 7 桁）× 規格
const groups = new Map();
for (const p of pm) {
  const g = `${p.yj_code.slice(0, 7)}|${strengthNorm(p.strength)}`;
  if (!groups.has(g)) groups.set(g, []);
  groups.get(g).push(p);
}
const bad = { capsule_tablet: [], release: [], od_to_plain: [], strength: [], generic_to_brand: [] };
const miss = { brand_to_generic: [], same_form_generic: [] };
let pairs = 0, selected = 0;
const fac = (p) => [{ id: p.brand_name, brand_name: p.brand_name, generic_name: "", strength: p.strength, adopted: true, product_key: p.product_key ?? p.brand_name }];
for (const [, list] of groups) {
  // 1 組が大きすぎるときは剤形ごとに 6 製品まで（--all で全部）
  let use = list;
  if (!ALL) {
    const byForm = new Map();
    for (const p of list) { const k = `${capsule(p)}|${od(p)}|${release(p)}|${generic(p)}`; byForm.set(k, [...(byForm.get(k) ?? []), p]); }
    use = [...byForm.values()].flatMap((v) => v.slice(0, 6));
  }
  for (const P of use) for (const F of use) {
    if (P === F || nk(P.brand_name) === nk(F.brand_name)) continue;
    pairs++;
    const m = matchRx(P.brand_name, P.strength, fac(F), D);
    const hit = m.best ? "best" : m.candidates.length ? "candidate" : null;
    if (m.best) selected++;
    const line = `${P.brand_name} → ${F.brand_name}（${hit}）`;
    if (hit) {
      if (capsule(P) !== capsule(F)) bad.capsule_tablet.push(line);
      else if (relKind(release(P)) !== relKind(release(F)) && !(release(P).startsWith("徐放") && release(F).startsWith("徐放"))) bad.release.push(`${line} [${release(P) || "普通"}→${release(F) || "普通"}]`);
      if (hit === "best" && od(P) && !od(F)) bad.od_to_plain.push(line);
      if (hit === "best" && strengthNorm(P.strength) !== strengthNorm(F.strength)) bad.strength.push(line);
      if (hit === "best" && generic(P) && brandLike(F)) bad.generic_to_brand.push(line);
    } else if (brandLike(P) && generic(F) && capsule(P) === capsule(F) && od(P) === od(F) && release(P) === release(F)) {
      miss.brand_to_generic.push(line.replace("（null）", ""));
    } else if (generic(P) && generic(F) && capsule(P) === capsule(F) && od(P) === od(F) && release(P) === release(F)) {
      miss.same_form_generic.push(line.replace("（null）", ""));
    }
  }
}
console.log(JSON.stringify({ pairs, selected, bad, miss }));
