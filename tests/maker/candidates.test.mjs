// 2. findCandidates と、索引（data/parent/maker-index.json）全体の不変条件
import test from "node:test";
import assert from "node:assert/strict";
import { imp, readJson } from "./_setup.mjs";

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

test("2-e. 索引の全データ：どの候補も、鍵の成分・剤形コード／規格／剤形と一致する（親マスタの値から作り直した鍵で確かめる）", (t) => {
  let drugs = 0, products = 0, multi = 0;
  const bad = [];
  for (const [key, d] of Object.entries(index.drugs)) {
    drugs++;
    if (d.products.length > 1) multi++;
    const [group, sk, form] = key.split("|");
    assert.equal(d.form, form, key);
    assert.equal(strengthKey(d.strength), sk, key);
    for (const c of findCandidates(index, key)) {
      products++;
      const p = byKey.get(c.product_key);
      if (!p) { bad.push(`${key}: 親マスタに無い ${c.product_key}`); continue; }
      if (p.group !== group) bad.push(`${key}: group ${p.group}`);
      if (strengthKey(p.strength) !== sk) bad.push(`${key}: 規格 ${p.strength}`);
      if (formOf(p.brand_name) !== form || formOf(c.brand_name) !== form) bad.push(`${key}: 剤形 ${p.brand_name}`);
      if (drugKey(p.group, p.strength, p.brand_name) !== key) bad.push(`${key}: drugKey ${c.product_key}`);
    }
  }
  t.diagnostic(`薬 ${drugs}（候補 2 つ以上 ${multi}）、候補として調べた製品 ${products}、食い違い ${bad.length}`);
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
