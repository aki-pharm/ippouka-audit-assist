// 用法の後処理（lib/rxFix.ts の parseNumberRun・parseDoseTimes・mapPattern・fixUsage）と袋の振り分け（lib/packing.ts）を品質が試す。
// 実物の写真の試験で rx15 Rp10 センノシド「0-0-0-2-0-0 1日1回 就寝前」を夕 2 と読んだ。寝る前の分が夕の袋に入ってはいけない
//   node --test tests/rx/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { ROOT } = require("./helpers.cjs");

const tsOk = Number(process.versions.node.split(".")[0]) >= 22 && process.features?.typescript;
const skip = !tsOk && "Node の TypeScript 読み込みが無い";
let cache;
const data = () => {
  if (!cache) {
    const r = spawnSync(process.execPath, ["--no-warnings", path.join(__dirname, "usage/check.mjs"), ROOT], { encoding: "utf8", maxBuffer: 1 << 26 });
    assert.equal(r.status, 0, r.stderr.slice(0, 400));
    cache = JSON.parse(r.stdout);
  }
  return cache;
};
const ex = (t) => data().examples.find((x) => x.text === t);
const per = (x) => [x.per.morning, x.per.noon, x.per.evening];

test("AKI の 4 例：朝夕 1-0-2-0-0-0 → 朝1・夕2、起床時・朝 1-2-0… → 朝2（起床時 1 は袋に入れない）、就寝前 0-0-0-2-0-0 → 袋 0（2 は入れない）、(2-1-1-1) 朝昼夕眠前 → 2・1・1（眠前 1 は入れない）", { skip }, () => {
  assert.deepEqual(per(ex("1-0-2-0-0-0 で投与 1日2回 朝夕食後")), [1, 0, 2]);
  const w = ex("1-2-0-0-0-0 で投与 1日2回 起床時・朝食後");
  assert.deepEqual([...per(w), w.unplaced], [2, 0, 0, 1]);
  const b = ex("0-0-0-2-0-0 で投与 1日1回 就寝前");
  assert.deepEqual([...per(b), b.unplaced], [0, 0, 0, 2]);
  assert.ok(b.flags.some((f) => /寝る前/.test(f)));
  const four = ex("(2-1-1-1) 朝・昼・夕食後及び就寝前");
  assert.deepEqual([...per(four), four.unplaced], [2, 1, 1, 1]);
});

test("数が合わない（毎食後に 0 でない数 2 つ）・同じ時点が 2 回（朝食後・朝食前）・時刻だけ（8時・14時・20時）は袋に入れず「合いません：要確認」", { skip }, () => {
  for (const t of ["1-0-2-0-0-0 で投与 1日3回 毎食後", "1-0-2 で投与 1日2回 朝食後・朝食前", "1-1-1 1日3回 8時・14時・20時"]) {
    const x = ex(t);
    assert.deepEqual(per(x), [0, 0, 0], t);
    assert.ok(x.flags.some((f) => /合いません/.test(f)), t);
  }
  assert.deepEqual(per(ex("2-1-2-0-0-0 で投与 1日3回 毎食後")), [2, 1, 2], "毎食後＝朝昼夕");
});

test("全角の数字・いろいろなハイフン（－ − ー ‐）・括弧つき「（1-0-2）」も並びとして読む。並びでない数（1回1錠・28日分）と「12時間持続」は時点にしない", { skip }, () => {
  for (const t of ["１－０－２－０－０－０ で投与 1日2回 朝夕食後", "1−0−2−0−0−0 で投与 1日2回 朝夕食後", "1ー0ー2ー0ー0ー0 で投与 1日2回 朝夕食後", "1‐0‐2‐0‐0‐0 で投与 1日2回 朝夕食後", "（1-0-2） 1日2回 朝夕食後"]) {
    assert.deepEqual(per(ex(t)), [1, 0, 2], t);
  }
  const a = ex("1回1錠（1日2錠） 28日分 1日2回 朝夕食後");
  assert.equal(a.run, null);
  assert.equal(a.same, true, "並びの無い普通の用法は何も変えない");
  const b = ex("1回1錠 1日1回 夕食後（12時間持続）");
  assert.deepEqual(b.times, ["evening"]);
  assert.equal(b.same, true);
});

test("並びの無い寝る前（就寝前・眠前・寝る前・就眠前・睡眠前）：寝る前だけなら夕の袋 0、夕食後・寝る前なら夕は 1 回量まで。正しい 夕食後・就寝前 は夕に 1 回量を入れる", { skip }, () => {
  for (const w of ["就寝前", "眠前", "寝る前", "就眠前", "睡眠前"]) {
    const rows = data().noRun.filter((x) => x.word === w);
    const by = (l) => rows.find((x) => x.label === l);
    assert.equal(by("寝る前だけ・AI が夕 2").bags.evening, 0, w);
    assert.equal(by("寝る前だけ・1回量なし・AI が夕 2").bags.evening, 0, w);
    assert.equal(by("夕食後と寝る前・AI が夕 2").bags.evening, 1, w);
    assert.equal(by("夕食後と寝る前・正しく夕 1").bags.evening, 1, w);
  }
  assert.deepEqual(data().correctEvening.map((x) => x.bags.evening), [1, 1, 2]);
});

test("起床時：起床時だけなら朝の袋 0、起床時・朝食後なら朝は 1 回量まで", { skip }, () => {
  assert.deepEqual(data().wake.map((x) => x.bags.morning), [0, 1, 1]);
});

test("【不具合】寝る前の書き方「ねる前」「就寝時」「寝前」を寝る前と読まず、AI が夕に入れた数がそのまま夕の袋に入る", { skip, todo: "lib/rxFix.ts の寝る前の語（就寝前|眠前|寝る前）に、ねる前・就寝時・寝前 など（ひらがな・時）が無い。parseDoseTimes と fixUsage の両方" }, () => {
  const bad = data().noRun.filter((x) => ["ねる前", "就寝時", "寝前"].includes(x.word) && x.label === "寝る前だけ・AI が夕 2" && x.bags.evening > 0).map((x) => `${x.text} → 夕の袋 ${x.bags.evening}`);
  assert.deepEqual(bad, []);
});

test("【不具合】夕食後・就寝前で 1 回量が分からない（欄も「1回○錠」も無い）とき、AI が夕に入れた数（寝る前の分を含みうる）をそのまま夕の袋に入れる（黄色の一言だけ）", { skip, todo: "1 回量が分からないなら、夕の数を袋に入れず「要確認」にする（並びと時点が合わないときと同じ扱い）。寝る前の分が夕の袋に入らないことを保証する" }, () => {
  const bad = data().noRun.filter((x) => ["就寝前", "眠前", "寝る前"].includes(x.word) && x.label === "夕食後と寝る前・1回量なし・AI が夕 2" && x.bags.evening > 0).map((x) => `${x.text} → 夕の袋 ${x.bags.evening}`);
  assert.deepEqual(bad, []);
});

test("性質の試験（4,000 通り）：寝る前（就寝前・眠前・寝る前）を含む用法で AI が夕にどんな数を入れても、寝る前だけの分は夕の袋に入らない（1 回量が分かる場合）", { skip }, (t) => {
  const p = data().property;
  t.diagnostic(`試した ${p.tried}`);
  assert.equal(p.tried, 4000);
  assert.deepEqual(p.bad, []);
});

test("2 回当てても同じ（toRows は /api/read-rx の後にもう一度当てる）。正解 145 行は袋の数が変わらない（寝る前の 6 行に一言が付くだけ）", { skip }, () => {
  assert.deepEqual(data().idempotent.filter((x) => !x.ok).map((x) => x.text), []);
  const tr = data().truth;
  assert.equal(tr.length, 145);
  assert.deepEqual(tr.filter((x) => x.changed).map((x) => `${x.f} Rp${x.rp}`), []);
  assert.deepEqual(tr.filter((x) => x.flags.length).map((x) => `${x.f.slice(0, 4)}-${x.rp}`).sort(), ["rx09-06", "rx12-06", "rx15-07", "rx15-10", "rx17-05", "rx20-10"]);
});

test("アプリ・ランナー・袋の 3 か所で同じ後処理を使う", () => {
  assert.match(fs.readFileSync(path.join(ROOT, "app/api/read-rx/route.ts"), "utf8"), /fixUsageAll\(fillStrengthFromName\(parsed\)\.result\)/);
  assert.match(fs.readFileSync(path.join(ROOT, "scripts/read-rx-batch.ts"), "utf8"), /fixUsageAll\(fixed\.result\)/);
  assert.match(fs.readFileSync(path.join(ROOT, "lib/packing.ts"), "utf8"), /const item = fixUsage\(raw\);/);
});

// ---------- 画面の「対応する製品」（components/MakerPicker.tsx の DrugPicker）。React を動かさず、作りを読む ----------
const picker = () => fs.readFileSync(path.join(ROOT, "components/MakerPicker.tsx"), "utf8");
const flow = () => fs.readFileSync(path.join(ROOT, "components/Flow.tsx"), "utf8");

test("対応する製品は 1 行に 1 つ：選ぶと tablet_id を 1 つにし、前後の薬のメーカーの選択を外す（別の薬の選択が残らない）", () => {
  assert.match(picker(), /function selectTablet\(id: string \| null\) \{\s*onSelectTablet\(id\);/);
  assert.match(flow(), /onSelectTablet=\{\(id\) => updateRow\(r\.key, \{ tablet_id: id \}, true\)\}/);
  assert.match(flow(), /if \(before\) delete next\[before\];\s*if \(after\) delete next\[after\];/);
});

test("【不具合】「別の薬から探す」は施設のマスタ全体（採用中止も）を札なしで出し、選んでも理由・変更者を記録しない（決まりで外した製品を黙って選べる）", { todo: "採用中止は出さないか「採用中止」の札、照合の候補でない製品には「ルール外」の札、選ぶときは理由と変更者を入れさせて記録する（lib/matching.ts の buildRuleOverrideRecord）。選んだ後は前の照合の一言（match_note）を消すか「手で選んだ」に替える" }, () => {
  const src = picker();
  const i = src.indexOf("const hits =");
  assert.match(src.slice(i, src.indexOf(";", i)), /adopted/, "採用中止を除いていない");
  assert.match(src, /buildRuleOverrideRecord/, "理由・変更者の記録が無い");
});

test("【不具合】「施設の採用品」の一覧に、同じ薬の鍵の入れ替えない組（ザルティア↔シアリス など）や後発→先発の候補が、理由の札なしで並ぶ", { todo: "sameDrugOf は drug_key が同じ採用品を全部出す。入れ替えない組・事前合意が要る候補には、照合の理由（候補にとどめた理由）を 1 件ずつ札で出す" }, () => {
  const src = flow();
  const i = src.indexOf("function sameDrugOf");
  assert.match(src.slice(i, src.indexOf("\n  }", i)), /exception|ruleOut|candOnly|理由/);
});
