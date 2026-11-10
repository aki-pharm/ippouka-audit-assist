// node --test tests/   （scripts/eval/score-drafts.cjs の判定ルールの単体テスト）
const test = require("node:test");
const assert = require("node:assert/strict");
const { judge } = require("../../scripts/eval/score-drafts.cjs");
const { norm, isUnconfirmed } = require("../../scripts/eval/lib.cjs");

test("空白（半角・全角）は取り除いて比べる", () => {
  assert.equal(norm(" SW  NF CR20 "), "SWNFCR20");
  assert.equal(norm("ラベプラ　10　オーハラ"), "ラベプラ10オーハラ");
  assert.equal(judge("imprint_front", "SW NF CR20", "SWNF CR20"), "match");
});

test("未確認・null・空文字は「未確認・空欄」", () => {
  assert.ok(isUnconfirmed("未確認"));
  assert.ok(isUnconfirmed(null));
  assert.ok(isUnconfirmed("  "));
  assert.ok(!isUnconfirmed("なし"));
  assert.equal(judge("imprint_back", "未確認", "なし"), "unconfirmed");
  assert.equal(judge("shape", null, "oval"), "unconfirmed");
});

test("下書きに値があってマスタと違えば「誤った値」", () => {
  assert.equal(judge("imprint_front", "KH603", "オルケディア 4"), "wrong");
  assert.equal(judge("imprint_back", "なし", "5"), "wrong");
});

test("数値は数として比べる（7 と 7.0 は一致、null 同士も一致）", () => {
  assert.equal(judge("size_long_mm", 7, 7.0), "match");
  assert.equal(judge("size_long_mm", "7.0", 7), "match");
  assert.equal(judge("size_long_mm", 7.2, 7.3), "wrong");
  assert.equal(judge("thickness_mm", null, 3.3), "unconfirmed");
  assert.equal(judge("thickness_mm", null, null), "match");
});
