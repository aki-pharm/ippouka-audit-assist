// node --test tests/   （scripts/eval/check-parent.cjs の刻印候補の拾い方の単体テスト）
const test = require("node:test");
const assert = require("node:assert/strict");
const { imprintCandidates, coveredByImprint } = require("../../scripts/eval/check-parent.cjs");

test("補足から刻印らしい文字列を拾う", () => {
  assert.deepEqual(imprintCandidates("識別コード：NTBC2mg。表・裏の刻印の内訳は図のみ"), ["NTBC2mg"]);
  assert.ok(imprintCandidates("外形図に「20」「TCK」らしき印字が見える").includes("TCK"));
  assert.ok(imprintCandidates("識別コード SW 572。外形図に「10」の表示あり").includes("SW 572"));
  assert.ok(imprintCandidates("本文には「ミルタザピン 30 VTRS」と記載").includes("ミルタザピン 30 VTRS"));
});

test("刻印ではないものは拾わない", () => {
  assert.deepEqual(imprintCandidates("性状欄の文章に刻印・識別コードの記載なし（外形は図のみ）"), []);
  assert.deepEqual(imprintCandidates("直径7.0mm、厚さ3.2mm、重量約120mg"), []);
  assert.deepEqual(imprintCandidates("大きさは「4号カプセル」とのみ記載"), []);
  assert.deepEqual(imprintCandidates("「錠剤印字は2通りある。」との記載のみ"), []);
  assert.deepEqual(imprintCandidates("識別コードは「識別コード（PTP）」欄の記載"), []);
});

test("表・裏にすでに入っている文字列は取りこぼしではない", () => {
  assert.ok(coveredByImprint("SW 093", "SW093", "未確認"));
  assert.ok(coveredByImprint("DS|272", "DS272", "未確認"));
  assert.ok(!coveredByImprint("10", "P915", "未確認"));
  assert.ok(!coveredByImprint("EP200", "未確認", "未確認"));
});
