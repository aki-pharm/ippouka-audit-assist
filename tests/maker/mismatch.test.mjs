// 6. 置き換えの表示「処方：X → 入っている：Y」（mismatchLabel）
import test from "node:test";
import assert from "node:assert/strict";
import { imp, readJson, samples } from "./_setup.mjs";

const { mismatchLabel, makerLabel } = await imp("lib/makers.ts");
const { toRows } = await imp("lib/packing.ts");
const { findTablet, normalize, stripMaker, stripPrefix } = await imp("lib/master.ts");

const t = (brand_name, aliases = []) => ({ brand_name, aliases });

test("6-a. 表記ゆれ（空白・全角・括弧内・【般】）だけの違いは同じ製品（null）", () => {
  const d = t("アムロジピン錠5mg「トーワ」");
  assert.equal(mismatchLabel("アムロジピン錠5mg「トーワ」", d), null);
  assert.equal(mismatchLabel("アムロジピン錠 5mg 「トーワ」", d), null);
  assert.equal(mismatchLabel("アムロジピン錠５ｍｇ「トーワ」", d), null);
  assert.equal(mismatchLabel("アムロジピン錠5mg「トーワ」（後発品）", d), null);
  assert.equal(mismatchLabel("【般】アムロジピン錠5mg「トーワ」", d), null);
});

test("6-b. マスタの別名（aliases）と一致すれば null", () => {
  const d = t("ラベプラゾールNa錠10mg「オーハラ」", ["ラベプラゾールナトリウム錠10mg「オーハラ」", "【般】ラベプラゾールナトリウム錠10mg"]);
  assert.equal(mismatchLabel("ラベプラゾールナトリウム錠10mg「オーハラ」", d), null);
  assert.equal(mismatchLabel("【般】ラベプラゾールナトリウム錠10mg", d), null);
});

test("6-c. 先発名 → 後発品、メーカー違い（トーワ → NP）は表示を出す", () => {
  assert.equal(mismatchLabel("ノルバスク錠5mg", t("アムロジピン錠5mg「トーワ」")), "処方：ノルバスク錠5mg → 入っている：アムロジピン錠5mg「トーワ」");
  assert.equal(mismatchLabel("アムロジピン錠5mg「トーワ」", t("アムロジピン錠5mg「NP」")), "処方：アムロジピン錠5mg「トーワ」 → 入っている：アムロジピン錠5mg「NP」");
  assert.equal(mismatchLabel("【般】アムロジピン錠5mg", t("アムロジピン錠5mg「NP」")), "処方：【般】アムロジピン錠5mg → 入っている：アムロジピン錠5mg「NP」");
});

test("6-c2. 参考：半角括弧でメーカーを書いた表記は括弧内ごと消えるので、表示が出る（見落としにはならない側）", () => {
  assert.notEqual(mismatchLabel("アムロジピン錠5mg(トーワ)", t("アムロジピン錠5mg「トーワ」")), null);
});

test("6-d. 描く製品が無い・処方の表記が空なら null", () => {
  assert.equal(mismatchLabel("アムロジピン錠5mg", undefined), null);
  assert.equal(mismatchLabel("アムロジピン錠5mg", null), null);
  assert.equal(mismatchLabel("  ", t("アムロジピン錠5mg")), null);
});

test("6-e. makerLabel：「」内 → maker 欄（製造販売元／を除く）→（先発）", () => {
  assert.equal(makerLabel({ brand_name: "アムロジピン錠5mg「トーワ」", maker: "東和薬品" }), "トーワ");
  assert.equal(makerLabel({ brand_name: "ノルバスク錠5mg", maker: "製造販売元／ヴィアトリス製薬" }), "ヴィアトリス製薬");
  assert.equal(makerLabel({ brand_name: "ノルバスク錠5mg", maker: "" }), "（先発）");
  assert.equal(makerLabel(null), "");
});

test("6-f. 見本の処方：前の表示（メーカーを除いて比べる）と今の表示の違いを数える（メーカー違いで増える分）", (t2) => {
  let rows = 0, oldN = 0, newN = 0, onlyNew = 0, onlyOld = 0;
  for (const { rx } of samples()) for (const r of toRows(rx)) {
    const tab = findTablet(r.tablet_id);
    if (!tab) continue;
    rows++;
    const old = stripPrefix(normalize(stripMaker(tab.brand_name))) !== stripPrefix(normalize(stripMaker(r.name_as_written)));
    const now = mismatchLabel(r.name_as_written, tab) != null;
    oldN += old; newN += now;
    if (now && !old) onlyNew++;
    if (old && !now) onlyOld++;
  }
  t2.diagnostic(`マスタにつながった行 ${rows}：前の表示 ${oldN}、今の表示 ${newN}（今だけ ${onlyNew}、前だけ ${onlyOld}）`);
  // 前は出ていたのに今は消えた行は無いこと（置き換えの見落としを増やさない）
  assert.equal(onlyOld, 0);
});
