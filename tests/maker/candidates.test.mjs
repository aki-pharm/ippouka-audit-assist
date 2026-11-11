// 2. findCandidates と、索引（data/parent/maker-index.json）全体の不変条件
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { imp, readJson, REPO } from "./_setup.mjs";

const { findCandidates, drugKey, formOf, strengthKey } = await imp("lib/makers.ts");
const index = readJson("data/parent/maker-index.json");
const pm = readJson("data/parent/parent-master.json").products;
const byKey = new Map(pm.map((p) => [p.product_key, p]));
const ORDER = { verified: 0, confirmed: 1, draft: 2 };

const mini = {
  drugs: {
    "X|5|錠": { generic_name: "エックス", strength: "5mg", form: "錠", products: [
      { product_key: "d2", brand_name: "イ錠5mg「B」", status: "draft" },
      { product_key: "v1", brand_name: "ウ錠5mg「C」", status: "verified" },
      { product_key: "c1", brand_name: "エ錠5mg「D」", status: "confirmed" },
      { product_key: "d1", brand_name: "ア錠5mg「A」", status: "draft" },
      { product_key: "n1", brand_name: "オ錠5mg「E」" }, // status 無し → draft 扱い
    ] },
    "X|5|OD錠": { generic_name: "エックス", strength: "5mg", form: "OD錠", products: [
      { product_key: "od", brand_name: "アOD錠5mg「A」", status: "verified" },
    ] },
  },
};

test("2-a. 同じ鍵の製品だけを返し、今の製品は除く", () => {
  const r = findCandidates(mini, "X|5|錠", "v1");
  assert.deepEqual(r.map((c) => c.product_key).sort(), ["c1", "d1", "d2", "n1"]);
  assert.ok(!r.some((c) => c.product_key === "od"));
});

test("2-b. 並び：実物 → 添付文書 → 下書き、同じなら販売名の順。status 無しは下書き", () => {
  const r = findCandidates(mini, "X|5|錠");
  assert.deepEqual(r.map((c) => c.product_key), ["v1", "c1", "d1", "d2", "n1"]);
  assert.equal(r.at(-1).status, "draft");
});

test("2-c. 鍵が無い・索引に無い鍵は空配列", () => {
  assert.deepEqual(findCandidates(mini, null), []);
  assert.deepEqual(findCandidates(mini, undefined), []);
  assert.deepEqual(findCandidates(mini, ""), []);
  assert.deepEqual(findCandidates(mini, "Y|5|錠"), []);
  assert.deepEqual(findCandidates(index, "存在しない|1|錠"), []);
});

test("2-d. 索引で省いた欄は既定値（刻印・色は「未確認」、数値は null、flags は []）", () => {
  const c = findCandidates(mini, "X|5|錠", null).find((x) => x.product_key === "n1");
  assert.equal(c.imprint_front, "未確認");
  assert.equal(c.imprint_back, "未確認");
  assert.equal(c.color, "未確認");
  assert.equal(c.size_long_mm, null);
  assert.equal(c.shape, null);
  assert.deepEqual(c.flags, []);
  assert.equal(c.maker, "");
});

test("2-e. 索引の全データ：どの候補も、鍵の成分・剤形コード／規格／剤形と一致する（親マスタの値と yj_code から作り直した鍵で確かめる）", (t) => {
  let drugs = 0, products = 0, multi = 0, yjDrugs = 0;
  const bad = [];
  for (const [key, d] of Object.entries(index.drugs)) {
    drugs++;
    if (d.products.length > 1) multi++;
    const [group, sk, form, yjSeg] = key.split("|");
    if (yjSeg) { yjDrugs++; assert.match(yjSeg, /^YJ(徐放|腸溶)$/, key); }
    assert.equal(d.form, form, key);
    assert.equal(strengthKey(d.strength), sk, key);
    for (const c of findCandidates(index, key)) {
      products++;
      const p = byKey.get(c.product_key);
      if (!p) { bad.push(`${key}: 親マスタに無い ${c.product_key}`); continue; }
      if (p.group !== group) bad.push(`${key}: group ${p.group}`);
      if (strengthKey(p.strength) !== sk) bad.push(`${key}: 規格 ${p.strength}`);
      if (formOf(p.brand_name) !== form || formOf(c.brand_name) !== form) bad.push(`${key}: 剤形 ${p.brand_name}`);
      if (drugKey(p.group, p.strength, p.brand_name, p.yj_code) !== key) bad.push(`${key}: drugKey ${c.product_key}`);
      // YJ の手がかりは、YJ の 8 桁目が徐放・腸溶（G・N・H）で上 7 桁が成分・剤形コードと同じときだけ
      if (yjSeg) assert.ok(/^[GNH]$/.test(p.yj_code?.[7] ?? "") && p.yj_code.slice(0, 7) === group.slice(0, 7), `${key}: ${c.product_key} ${p.yj_code}`);
    }
  }
  t.diagnostic(`薬 ${drugs}（候補 2 つ以上 ${multi}、うち YJ の手がかりつき ${yjDrugs}）、候補として調べた製品 ${products}、食い違い ${bad.length}`);
  assert.deepEqual(bad.slice(0, 20), []);
  assert.equal(drugs, index.drug_count);
  assert.equal(products, index.product_count);
});

test("2-f. 索引の全データ：今の製品を除くと候補が 1 つ減り、並びは確認の状態の順を崩さない", () => {
  for (const [key, d] of Object.entries(index.drugs)) {
    const cur = d.products[0].product_key;
    const r = findCandidates(index, key, cur);
    const dup = d.products.filter((p) => p.product_key === cur).length;
    assert.equal(r.length, d.products.length - dup, key);
    for (let i = 1; i < r.length; i++) assert.ok(ORDER[r[i - 1].status] <= ORDER[r[i].status], key);
  }
});

test("2-g. 索引の全データ：1 つの薬の中で product_key が重ならない", (t) => {
  const dups = [];
  for (const [key, d] of Object.entries(index.drugs)) {
    const ks = d.products.map((p) => p.product_key);
    if (new Set(ks).size !== ks.length) dups.push(key);
  }
  t.diagnostic(`重なりのある薬 ${dups.length}`);
  assert.deepEqual(dups, []);
});

// ---------- 索引の全データで、1 つの薬に放出・剤形の違う製品が混ざっていないか（鍵の作り方とは別の、品質側の判定で数える） ----------
const MARK = readJson("data/parent/form-markers.json");
/** 販売名の放出の印（form-markers.json の release と anywhere。EN は腸溶）。印が無ければ「なし」 */
function releaseSig(name) {
  const full = name.normalize("NFKC").replace(/「[^」]*」/g, "");
  const m = full.replace(/[（(][^）)]*[）)]/g, "");
  const s = new Set();
  for (const w of MARK.anywhere) if (full.includes(w)) s.add(w);
  for (const x of m.matchAll(/([A-Za-z]+)[\s\-・]*(錠|カプセル)/g)) {
    if (/\d$/.test(m.slice(0, x.index))) continue;
    if (MARK.release.includes(x[1])) s.add(MARK.rename[x[1]] ?? x[1]);
  }
  if (m.includes("速崩錠")) s.add("速崩");
  return [...s].sort().join("+") || "なし";
}
// 口腔内崩壊の印は data/parent/form-markers.json の od から（レディタブなど、足された印も読む）。英字の印は前が英字でないときだけ
const odWords = MARK.od.map((w) => (/^[A-Za-z]+$/.test(w) ? `(?<![A-Za-z])${w}[\\s-]*錠` : w));
const isOdName = (n) => new RegExp(`${odWords.join("|")}|ODフィルム`).test(n.normalize("NFKC").replace(/「[^」]*」/g, ""));

test("2-h. 索引の全データ：(a) 放出の印が違う製品 (b) YJ の徐放・腸溶（G・N・H）と普通 (c) 口腔内崩壊錠と普通、が同じ薬に混ざらない", (t) => {
  const A = [], B = [], C = [];
  for (const [key, d] of Object.entries(index.drugs)) {
    const g = key.split("|")[0];
    const names = d.products.map((p) => p.brand_name);
    if (new Set(names.map(releaseSig)).size > 1) A.push(`${key}: ${names.map((n) => `${n}〈${releaseSig(n)}〉`).join("／")}`);
    const yj = new Set();
    for (const p of d.products) {
      const y = byKey.get(p.product_key)?.yj_code ?? "";
      if (y.length >= 8 && y.slice(0, 7) === g.slice(0, 7)) yj.add(MARK.yj[y[7]] ? "徐放・腸溶" : "普通");
    }
    if (yj.size > 1) B.push(`${key}: ${names.join("／")}`);
    if (new Set(names.map(isOdName)).size > 1) C.push(`${key}: ${names.join("／")}`);
  }
  t.diagnostic(`薬 ${Object.keys(index.drugs).length}：(a) ${A.length}、(b) ${B.length}、(c) ${C.length}`);
  assert.deepEqual(A, []);
  assert.deepEqual(B, []);
  assert.deepEqual(C, []);
});

test("2-i. 名前にも YJ にも印の無い徐放製剤（テオドール・テオロング、ペンタサ）は、普通の製剤と同じ薬に入っていない", (t) => {
  // 国の一覧（naifuku-tablets-*.csv）で、テオロング錠の YJ は「テオフィリン○mg徐放錠」の統一名で載っている＝徐放錠
  const naifuku = readCsvLines("data/parent/naifuku-tablets-20261101.csv");
  for (const [key, expect] of [["2251001F|50|錠", ["テオドール錠50mg", "テオロング錠50mg"]], ["2251001F|100|錠", ["テオドール錠100mg", "テオロング錠100mg"]], ["2251001F|200|錠", ["テオドール錠200mg", "テオロング錠200mg"]],
    ["2399009F|250|錠", ["ペンタサ錠250mg", "メサラジン錠250mg「ケミファ」"]], ["2399009F|500|錠", ["ペンタサ錠500mg", "メサラジン錠500mg「ケミファ」"]]]) {
    const names = index.drugs[key].products.map((p) => p.brand_name).sort();
    assert.deepEqual(names, [...expect].sort(), key);
    const notes = index.drugs[key].products.map((p) => { const y = byKey.get(p.product_key).yj_code; return `${p.brand_name}〈${y}：${naifuku.get(y) ?? "一覧に無い"}〉`; });
    t.diagnostic(`${key}：${notes.join("／")}`);
  }
  for (const y of ["2251001F1011", "2251001F2018", "2251001F3014"].filter((y) => naifuku.has(y))) assert.match(naifuku.get(y), /徐放錠/, y);
});

function readCsvLines(rel) {
  const m = new Map();
  for (const line of readFileSync(path.join(REPO, rel), "utf8").split("\n").slice(1)) {
    const c = line.split('","').map((x) => x.replace(/^"|"$/g, ""));
    if (c.length > 3) m.set(c[0], c[3]);
  }
  return m;
}
