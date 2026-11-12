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

test("直った：寝る前の書き方（ねる前・就寝時・就眠時・寝前・ねるまえ・寝る前に・就寝前頃・睡眠前）も寝る前と読む。寝る前が先に書かれても（眠前・夕食後）、「夕食後及び寝る前」でも、寝る前の分は夕の袋に入らない", { skip }, () => {
  const rows = data().noRun;
  const bad = [];
  for (const x of rows) {
    const limit = /^寝る前だけ/.test(x.label) ? 0 : /1回量なし/.test(x.label) ? 0 : 1;
    if (x.bags.evening > limit) bad.push(`${x.text}（${x.label}）→ 夕の袋 ${x.bags.evening}`);
  }
  assert.deepEqual(bad, []);
  // 正しく夕 1 の行は夕に 1 を入れる（寝る前の語で夕を消しすぎない）
  assert.deepEqual(rows.filter((x) => x.label === "夕食後と寝る前・正しく夕 1" && x.bags.evening !== 1).map((x) => x.text), []);
});

test("直った：1 回量が分からない 夕食後・寝る前 は夕を袋に入れず「1回量が分からないため要確認」", { skip }, () => {
  for (const x of data().noRun.filter((x) => x.label === "夕食後と寝る前・1回量なし・AI が夕 2")) {
    assert.equal(x.bags.evening, 0, x.text);
    assert.ok(x.flags.some((f) => /1回量が分からない/.test(f)), x.text);
  }
});

test("性質の試験（4,000 通り）：寝る前（10 通りの書き方）を含む用法で AI が夕にどんな数を入れても、寝る前だけの分は夕の袋に入らない。1 回量が分からなければ夕は 0", { skip }, (t) => {
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

test("ランナーと袋で後処理が実際に効く：ランナーは偽の読み取り（rx15 Rp10 の「0-0-0-2-0-0 就寝前」を夕 2、規格が空）を夕 0・規格 12mg にして保存する（袋は上の試験で toRows を通して確かめた。/api/read-rx は refactor.test の差分の固定で）", { skip }, () => {
  const os = require("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rxfix-run-"));
  fs.mkdirSync(path.join(dir, "img"));
  fs.copyFileSync(path.join(ROOT, "data/rx-testset/images/rx15-2.png"), path.join(dir, "img/rx15-2__QA__t__clean.png"));
  const r = spawnSync(process.execPath, ["--no-warnings", "--import", path.join(__dirname, "readrx/register-fake.mjs"), "scripts/read-rx-batch.ts", "--images", path.join(dir, "img"), "--out", path.join(dir, "out"), "--max-usd", "1"], {
    cwd: ROOT, encoding: "utf8", env: { ...process.env, CLAUDE_API_KEY: "fake", ANTHROPIC_API_KEY: "", RX_FAKE: "bedtime" },
  });
  assert.equal(r.status, 0, r.stderr.slice(0, 300));
  const rec = JSON.parse(fs.readFileSync(path.join(dir, "out", fs.readdirSync(path.join(dir, "out")).find((f) => f.endsWith(".json"))), "utf8"));
  fs.rmSync(dir, { recursive: true, force: true });
  const it = rec.result.items[0];
  assert.deepEqual(it.per_timing, { morning: 0, noon: 0, evening: 0 });
  assert.equal(it.unplaced, 2);
  assert.equal(it.strength, "12mg");
  assert.equal(it.name_as_written, "センノシド錠12mg「サワイ」");
  assert.equal(rec.usage_fixed, 1);
  assert.equal(rec.strength_filled, 1);
});

// ---------- 画面の「対応する製品」の札と記録（lib/matching.ts の explainCandidate・buildRuleOverrideRecord を動かす） ----------
function explain(q) {
  const r = spawnSync(process.execPath, ["--no-warnings", path.join(__dirname, "matching/explain.mjs"), ROOT, "explain", JSON.stringify(q)], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr.slice(0, 300));
  return JSON.parse(r.stdout);
}
function record(q) {
  const r = spawnSync(process.execPath, ["--no-warnings", path.join(__dirname, "matching/explain.mjs"), ROOT, "record", JSON.stringify(q)], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr.slice(0, 300));
  return JSON.parse(r.stdout);
}

test("札：1 件ずつの種類と理由（入れ替えない組・事前合意があれば選択可・置き換え・ルール外の理由・採用中止・以前の採用）", { skip }, () => {
  const cases = [
    ["ザルティア錠5mg", "5mg", "シアリス錠5mg", {}, "candidate", /自動では入れ替えない組/],
    ["アムロジピン錠5mg「サワイ」", "5mg", "ノルバスク錠5mg", {}, "candidate", /事前合意（みなし疑義）があれば選択可/],
    ["ブロチゾラム錠0.25mg「サワイ」", "0.25mg", "レンドルミンD錠0.25mg", {}, "candidate", /事前合意/],
    ["メトホルミン塩酸塩錠250mg「SN」", "250mg", "メトグルコ錠250mg", {}, "candidate", /YJ の上 9 桁が違う/],
    ["オースギ大柴胡湯エキスT錠", "1錠", "クラシエ大柴胡湯エキス錠", {}, "candidate", /漢方/],
    ["【般】ニフェジピン徐放錠10mg", "10mg", "ニフェジピンCR錠10mg「サワイ」", {}, "candidate", /12時間／24時間/],
    ["リピトール錠10mg", "10mg", "アトルバスタチン錠10mg「サワイ」", {}, "auto", /置き換え：先発品の処方を後発品に/],
    ["アムロジピン錠5mg「トーワ」", "5mg", "アムロジピンOD錠5mg「サワイ」", {}, "auto", /置き換え：普通の錠の処方を OD 錠に/],
    ["アムロジピンOD錠5mg「トーワ」", "5mg", "アムロジピン錠5mg「サワイ」", {}, "ruleOut", /OD 錠の処方を普通の錠に/],
    ["ランソプラゾールカプセル15mg「サワイ」", "15mg", "ランソプラゾールOD錠15mg「サワイ」", {}, "ruleOut", /カプセルと錠/],
    ["アムロジピン錠5mg「トーワ」", "5mg", "アムロジピン錠10mg「サワイ」", {}, "ruleOut", /規格が違う/],
    ["ニフェジピンL錠20mg「トーワ」", "20mg", "ニフェジピンCR錠20mg「サワイ」", {}, "ruleOut", /放出/],
    ["【般】ニフェジピン徐放錠10mg", "10mg", "ニフェジピンCR錠10mg「サワイ」", { nameNote: "12時間持続" }, "ruleOut", /放出/],
    ["アムロジピン錠5mg「トーワ」", "5mg", "アムロジピン錠5mg「サワイ」", { adopted: false }, "discontinued", /^採用中止$/],
    ["アムロジピン錠5mg「トーワ」", "5mg", "アムロジピン錠5mg「サワイ」", { adopted: false, discontinued_reason: "メーカー切替" }, "discontinued", /以前の採用/],
  ];
  const r = explain(cases.map(([a, b, c, o]) => [a, b, c, o]));
  r.forEach((x, i) => {
    assert.equal(x.kind, cases[i][4], `${x.name} → ${x.fac}`);
    assert.match(x.reason ?? "", cases[i][5], `${x.name} → ${x.fac}：${x.reason}`);
  });
});

test("記録：札のある製品を選ぶ記録は、理由と変更者が無い・空白だけなら作れない。そろえば処方の名前・製品・札の理由・理由・変更者・日時が残る", { skip }, () => {
  const base = { name_as_written: "ザルティア錠5mg", product: "シアリス錠5mg", rule: "自動では入れ替えない組" };
  const r = record([{ ...base, reason: "", changed_by: "A" }, { ...base, reason: "   ", changed_by: "A" }, { ...base, reason: "医師確認", changed_by: "" }, { ...base, reason: "医師確認", changed_by: " " }, { ...base, reason: " 医師確認 ", changed_by: " A " }]);
  for (const x of r.slice(0, 4)) assert.ok(x.error, JSON.stringify(x));
  assert.deepEqual(r[4].record, { name_as_written: "ザルティア錠5mg", product_id: "シアリス錠5mg", rule: "自動では入れ替えない組", reason: "医師確認", changed_by: "A", changed_at: "2026-11-12T00:00:00.000Z" });
});

test("【不具合】「別の薬から探す」で同じ薬でない製品（kind=other）を選ぶと、札も記録も無い（読み取りが別の薬を選んだときの直しでも、手で選んだことが残らない）", { skip, todo: "explainCandidate の other に「別の薬」の札を付け、画面は other も理由と変更者を入れて記録する" }, () => {
  const [x] = explain([["アムロジピン錠5mg「トーワ」", "5mg", "ロキソプロフェンNa錠60mg「サワイ」"]]);
  assert.equal(x.kind, "other");
  assert.ok(x.reason, "other の札が無い（画面は札も記録もなく選ぶ）");
});

test("【不具合】どの札なら理由と変更者が要るか（画面の pickLabelled）と、手で選んだ後の行の一言・状態（Flow の updateRow）が React の中にあり、外で試せない", { skip, todo: "lib に純粋な関数（例：needsOverrideRecord(kind)、行を手で変えたときの { match_note, match_status } を返す関数）を出し、画面はそれを呼ぶ。今は採用中止の製品を手で選んでも match_status が「採用品」になる" }, () => {
  // 文字を探すのでなく、実際に lib から読み込んで呼べるかで見る
  const js = `const m = await import(${JSON.stringify("file://" + path.join(ROOT, "lib/matching.ts"))}); const f = Object.entries(m).find(([k, v]) => typeof v === "function" && /^(needs|requires)\\w*Record$/.test(k)); if (!f) { console.log("none"); process.exit(0); } console.log(JSON.stringify(["auto","candidate","ruleOut","discontinued","other"].map((k) => f[1](k))));`;
  const r = spawnSync(process.execPath, ["--no-warnings", "--input-type=module", "-e", js], { encoding: "utf8" });
  assert.notEqual(r.stdout.trim(), "none", "lib に判断の関数が無い");
  assert.deepEqual(JSON.parse(r.stdout), [false, true, true, true, true]);
});
