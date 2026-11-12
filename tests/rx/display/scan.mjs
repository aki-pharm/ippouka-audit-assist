// lib/display.ts の刻印の種類（imprintKind）を、親マスタの全製品で品質が試す。
// node --no-warnings scan.mjs <リポジトリ> → JSON
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
const d = await import(pathToFileURL(path.join(ROOT, "lib/display.ts")).href);
const pm = JSON.parse(fs.readFileSync(path.join(ROOT, "data/parent/parent-master.json"), "utf8")).products;
const n = (s) => (s ?? "").normalize("NFKC");

/** 刻印の中の、名前・規格では説明できない英字・数字（見分けに使える記号）。英字は販売名にあるもの（OD・L など）も別に数える */
function extras(imprint, p) {
  const s = n(imprint);
  const nums = new Set((n(`${p.brand_name} ${p.strength ?? ""}`).match(/\d+(?:\.\d+)?/g) ?? []));
  const digits = (s.match(/\d+(?:\.\d+)?/g) ?? []).filter((x) => !nums.has(x));
  const latin = s.match(/[A-Za-z]+/g) ?? [];
  const brand = n(p.brand_name).toUpperCase();
  return { digits, latinInName: latin.filter((w) => brand.includes(w.toUpperCase())), latinOther: latin.filter((w) => !brand.includes(w.toUpperCase())) };
}

const out = { products: pm.length, sides: 0, kinds: {}, nameWithExtra: [], nameWithLatinInBrand: [], crossMaker: { tried: 0, hidden: [] } };
const nameSides = [];
for (const p of pm) for (const side of ["imprint_front", "imprint_back"]) {
  out.sides++;
  const k = d.imprintKind(p[side], p);
  out.kinds[k] = (out.kinds[k] ?? 0) + 1;
  // 記号と判定した刻印は、一覧の 1 行（imprintSummary）に必ず出る（裏は表と同じ文字なら出さなくてよい）
  if (k === "code") {
    const sum = n(d.imprintSummary(p)).replace(/\s/g, ""), t = n(p[side]).replace(/\s/g, "");
    if (!sum.includes(t)) (out.codeNotShown ??= []).push({ product: p.product_key, side, imprint: p[side], summary: d.imprintSummary(p) });
  }
  if (k !== "name") continue;
  nameSides.push({ p, side });
  const e = extras(p[side], p);
  const row = { product: p.product_key, side, imprint: p[side], summary: d.imprintSummary(p) };
  if (e.digits.length || e.latinOther.length) out.nameWithExtra.push({ ...row, digits: e.digits, latin: e.latinOther });
  else if (e.latinInName.length) out.nameWithLatinInBrand.push({ ...row, latin: e.latinInName });
}
out.nameSides = nameSides.length;

// 他社の名前印字：同じ成分（group）・別メーカーの製品の名前印字を、この製品の刻印として判定する。
// 他社の印字はこの製品の名前ではないので「名前印字」に隠れてはいけない（刻印の取り違え・マスタの誤記を見落とす）
const byGroup = new Map();
for (const x of nameSides) byGroup.set(x.p.group, [...(byGroup.get(x.p.group) ?? []), x]);
const makerTag = (p) => (n(p.brand_name).match(/「([^」]+)」/) ?? [])[1] ?? n(p.maker);
for (const p of pm) for (const x of byGroup.get(p.group) ?? []) {
  if (x.p.maker === p.maker || makerTag(x.p) === makerTag(p)) continue;
  if (n(x.p[x.side]).replace(/\s/g, "") === n(p.imprint_front).replace(/\s/g, "")) continue;
  // 他社の印字のうち、この製品の名前・規格で説明できない部分（かな・漢字の他社名、英字の記号、規格と違う数字）があるものだけを試す
  // （成分名と規格だけの印字は、この製品に読んでも名前印字で正しい）
  const imp = x.p[x.side];
  const own = n(`${p.brand_name}${p.maker ?? ""}`).replace(/\s/g, "");
  const jaForeign = (n(imp).match(/[ぁ-ゖァ-ヺー一-鿿々]+/g) ?? []).filter((w) => [...w].length >= 2 && !own.includes(w));
  const e = extras(imp, p);
  const why = [...(jaForeign.length ? [`他社名 ${jaForeign.join("・")}`] : []), ...(e.latinOther.length ? [`記号 ${e.latinOther.join("・")}`] : []), ...(e.digits.length ? [`数字 ${e.digits.join("・")}`] : [])];
  if (!why.length) continue;
  out.crossMaker.tried++;
  if (d.imprintKind(imp, p) === "name") out.crossMaker.hidden.push({ product: p.product_key, foreignImprint: imp, from: x.p.product_key, why: why.join("／"), jaForeign: jaForeign.length > 0 });
}
out.crossMaker.hiddenCount = out.crossMaker.hidden.length;
out.crossMaker.hiddenJaForeign = out.crossMaker.hidden.filter((h) => h.jaForeign).length;
out.crossMaker.hiddenProducts = new Set(out.crossMaker.hidden.map((h) => h.product)).size;

// 決まった例（他社名・別の成分・名前の頭 2 文字だけ同じ語）
const P = (brand, maker) => ({ brand_name: brand, maker });
out.cases = Object.fromEntries([
  ["自社の名前印字", "ラベプラ 10 オーハラ", P("ラベプラゾールNa錠10mg「オーハラ」", "大原薬品工業株式会社")],
  ["他社名（トーワの錠にオーハラ）", "ラベプラ 10 オーハラ", P("ラベプラゾールNa錠10mg「トーワ」", "東和薬品株式会社")],
  ["他社名・頭 2 文字だけ同じ（トーワの錠にトーアエイヨー）", "アムロジピン 5 トーアエイヨー", P("アムロジピン錠5mg「トーワ」", "東和薬品株式会社")],
  ["別の成分・頭 2 文字だけ同じ（アムロジピンにアムバロ）", "アムバロ", P("アムロジピン錠5mg「トーワ」", "東和薬品株式会社")],
  ["別の成分（アムロジピンにニフェジピン）", "ニフェジピン 10", P("アムロジピン錠5mg「トーワ」", "東和薬品株式会社")],
  ["名前＋記号（記号が隠れる）", "アムロジピン TW 5", P("アムロジピン錠5mg「トーワ」", "東和薬品株式会社")],
  ["名前＋規格と違う数字", "アムロジピン 10 トーワ", P("アムロジピン錠5mg「トーワ」", "東和薬品株式会社")],
].map(([k, imp, p]) => [k, { imprint: imp, kind: d.imprintKind(imp, p), summary: d.imprintSummary({ ...p, imprint_front: imp, imprint_back: "なし" }) }]));

out.nameWithExtraCount = out.nameWithExtra.length;
out.nameWithExtraProducts = new Set(out.nameWithExtra.map((x) => x.product)).size;
console.log(JSON.stringify(out));
