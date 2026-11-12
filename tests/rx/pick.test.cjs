// lib/pick.ts（手で製品を選ぶときの判断：needsOverrideRecord・overrideRule・pickRowState）を、画面と同じ順に lib だけで動かして確かめる。
//   node --test tests/rx/
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { ROOT } = require("./helpers.cjs");

const tsOk = Number(process.versions.node.split(".")[0]) >= 22 && process.features?.typescript;
const skip = !tsOk && "Node の TypeScript 読み込みが無い";
const run = (q) => {
  const r = spawnSync(process.execPath, ["--no-warnings", path.join(__dirname, "matching/pick.mjs"), ROOT, JSON.stringify(q)], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr.slice(0, 300));
  return JSON.parse(r.stdout);
};
const OK = { reason: "医師に確認済み", changed_by: "QA" };
const CASES = [
  { label: "置き換え（先発→後発）", rx: "リピトール錠10mg", strength: "10mg", product: "アトルバスタチン錠10mg「サワイ」", kind: "auto" },
  { label: "置き換え（普通→OD）", rx: "アムロジピン錠5mg「トーワ」", strength: "5mg", product: "アムロジピンOD錠5mg「サワイ」", kind: "auto" },
  { label: "入れ替えない組", rx: "ザルティア錠5mg", strength: "5mg", product: "シアリス錠5mg", kind: "candidate", rule: /入れ替えない組/ },
  { label: "事前合意があれば選択可（後発→先発）", rx: "アムロジピン錠5mg「サワイ」", strength: "5mg", product: "ノルバスク錠5mg", kind: "candidate", rule: /事前合意/ },
  { label: "ルール外（OD→普通）", rx: "アムロジピンOD錠5mg「トーワ」", strength: "5mg", product: "アムロジピン錠5mg「サワイ」", kind: "ruleOut", rule: /OD 錠の処方を普通の錠に/ },
  { label: "ルール外（カプセル↔錠）", rx: "ランソプラゾールカプセル15mg「サワイ」", strength: "15mg", product: "ランソプラゾールOD錠15mg「サワイ」", kind: "ruleOut", rule: /カプセルと錠/ },
  { label: "ルール外（規格違い）", rx: "アムロジピン錠5mg「トーワ」", strength: "5mg", product: "アムロジピン錠10mg「サワイ」", kind: "ruleOut", rule: /規格が違う/ },
  { label: "採用中止", rx: "アムロジピン錠5mg「トーワ」", strength: "5mg", product: "アムロジピン錠5mg「サワイ」", adopted: false, kind: "discontinued", status: "採用中止" },
  { label: "以前の採用", rx: "アムロジピン錠5mg「トーワ」", strength: "5mg", product: "アムロジピン錠5mg「サワイ」", adopted: false, discontinued_reason: "メーカー切替", kind: "discontinued", status: "以前の採用" },
  { label: "別の薬（読み取りの直し）", rx: "アムロジピン錠5mg「トーワ」", strength: "5mg", product: "ロキソプロフェンNa錠60mg「サワイ」", kind: "other", rule: /^別の薬に直した$/ },
];

test("どの札で理由と変更者が要るか：自動で選ばれる製品（auto）だけ要らない。候補・ルール外・採用中止・以前の採用・別の薬は要る", { skip }, () => {
  const o = run([]);
  assert.deepEqual(o.kinds, [false, true, true, true, true]);
  assert.equal(o.labels.OTHER_DRUG_LABEL, "別の薬（読み取りの直し）");
});

test("札の種類と、理由と変更者がそろったときの記録の札（overrideRule）：別の薬は「別の薬に直した」、ほかは札の理由", { skip }, () => {
  const { out } = run(CASES.map((c) => ({ ...c, ...OK })));
  out.forEach((x, i) => {
    const c = CASES[i];
    assert.equal(x.ex.kind, c.kind, c.label);
    if (c.kind === "other") assert.equal(x.ex.reason, "別の薬（読み取りの直し）", c.label);
    if (c.kind === "auto") { assert.equal(x.needs, false, c.label); assert.equal(x.record, null); return; }
    assert.ok(x.record, `${c.label}：${x.error}`);
    if (c.rule) assert.match(x.record.rule, c.rule, c.label);
    assert.deepEqual([x.record.reason, x.record.changed_by, x.record.name_as_written, x.record.product_id], ["医師に確認済み", "QA", c.rx, c.product], c.label);
  });
});

test("理由・変更者が無い・空白だけなら記録できず、選ばれない（auto 以外のすべての札）", { skip }, () => {
  const blanks = [{ reason: "", changed_by: "QA" }, { reason: "   ", changed_by: "QA" }, { reason: "　", changed_by: "QA" }, { reason: "医師確認", changed_by: "" }, { reason: "医師確認", changed_by: " \t" }];
  const q = CASES.filter((c) => c.kind !== "auto").flatMap((c) => blanks.map((b) => ({ ...c, ...b })));
  const { out } = run(q);
  for (const x of out) {
    assert.equal(x.picked, false, `${x.label}（理由「${x.reason}」変更者「${x.changed_by}」）が選ばれた`);
    assert.ok(x.error, x.label);
    assert.equal(x.state, null);
  }
});

test("選んだ後の行の一言と状態：採用中止・以前の採用は状態もそのまま（「採用品」にしない）、別の薬・候補・ルール外は理由つきの一言、自動は「手で選びました」。外したら一言を消す。2 回呼んでも同じ", { skip }, () => {
  const o = run(CASES.map((c) => ({ ...c, ...OK })));
  const by = (l) => o.out.find((x) => x.label === l);
  assert.deepEqual(by("採用中止").state, { match_note: "手で選びました（採用中止）", match_status: "採用中止" });
  assert.deepEqual(by("以前の採用").state, { match_note: "手で選びました（以前の採用）", match_status: "以前の採用" });
  assert.deepEqual(by("別の薬（読み取りの直し）").state, { match_note: "手で選びました（別の薬に直した）", match_status: "採用品" });
  assert.match(by("入れ替えない組").state.match_note, /^手で選びました（自動では入れ替えない組/);
  assert.match(by("ルール外（OD→普通）").state.match_note, /^手で選びました（ルール外：OD 錠の処方を普通の錠に）$/);
  assert.deepEqual(by("置き換え（先発→後発）").state, { match_note: "手で選びました", match_status: "採用品" });
  assert.ok(o.out.every((x) => x.idempotent));
  assert.deepEqual(o.cleared, { match_note: null }, "外したら一言を消し、状態は変えない");
  assert.deepEqual(o.noEx, { match_note: "手で選びました", match_status: "採用品" });
});

test("手で採用中止・以前の採用の製品を選んだ行は、袋の確かめ（checkRow）で黄色の一言が出る。採用品なら出ない", { skip }, () => {
  const r = spawnSync(process.execPath, ["--no-warnings", path.join(__dirname, "usage/check.mjs"), ROOT], { encoding: "utf8", maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, r.stderr.slice(0, 300));
  const c = JSON.parse(r.stdout).checkRow;
  assert.ok(c[0].flags.includes("warn:採用中止の製品を選んでいます"), JSON.stringify(c[0]));
  assert.ok(c[1].flags.includes("warn:以前の採用の製品を選んでいます"), JSON.stringify(c[1]));
  assert.ok(!c[2].flags.some((f) => /の製品を選んでいます/.test(f)));
});
