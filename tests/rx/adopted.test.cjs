// 段階 2「採用品の選択」：採点（scripts/eval/score-adopted.mjs）と、アプリの照合（lib/master.ts の matchTablet）のふるまい。
//   node --test tests/rx/
// 【アプリの不具合】の todo は、アプリの照合の今のふるまいを記録するもの（アプリは直さない。直したら todo を外す）。
// matchTablet は品質が別に書いた差し替え（tests/rx/app/hooks.mjs）で、lib/master.ts を書き換えずに架空施設のマスタで動かす。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { ROOT, DATA, parseCsv } = require("./helpers.cjs");

const tsOk = Number(process.versions.node.split(".")[0]) >= 22 && process.features?.typescript;
const skip = !tsOk && "Node の TypeScript 読み込みが無い";
const FACILITY = path.join(DATA, "facility.json");
const facility = JSON.parse(fs.readFileSync(FACILITY, "utf8")).products;
const SCORER = path.join(ROOT, "scripts/eval/score-adopted.mjs");

/** アプリの matchTablet を施設のマスタで呼ぶ。queries：[[名前, 規格], ...] */
function match(queries, facilityFile = FACILITY) {
  const r = spawnSync(process.execPath, ["--no-warnings", path.join(__dirname, "app/match.mjs"), ROOT, facilityFile, JSON.stringify(queries)], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr.slice(0, 300));
  return JSON.parse(r.stdout);
}
const one = (name, strength) => match([[name, strength]])[0];

function runScorer(args, { cwd = ROOT } = {}) {
  return spawnSync(process.execPath, [SCORER, ...args], { cwd, encoding: "utf8" });
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "adopted-"));

// ---------- アプリの照合の呼び方（feature/matching-rules で中身は変わった。呼び方と返す形は前と同じ） ----------
test("matchTablet は前と同じ呼び方（名前, 規格）で動き、best・candidates・substituted を返す。3 つ目の options は任意", { skip }, () => {
  const src = fs.readFileSync(path.join(ROOT, "lib/master.ts"), "utf8");
  assert.match(src, /export function matchTablet\(nameAsWritten: string, strength\?: string \| null, options: MatchOptions = \{\}\)/);
  const [r] = match([["ノルバスク錠5mg", "5mg"]]);
  assert.equal(r.best, "アムロジピン錠5mg「サワイ」");
  assert.deepEqual(r.candidates, ["アムロジピン錠5mg「サワイ」"]);
  assert.equal(typeof r.substituted, "boolean");
  // アプリ（lib/packing.ts）は補足（name_note）を渡している
  assert.match(fs.readFileSync(path.join(ROOT, "lib/packing.ts"), "utf8"), /matchTablet\(item\.name_as_written, item\.strength, \{ nameNote: item\.name_note \}\)/);
  // 採点の差し替えは master.json と ./types の 2 つだけ（lib/master.ts から読まれたときだけ）
  const hooks = fs.readFileSync(path.join(ROOT, "scripts/eval/adopted-hooks.mjs"), "utf8");
  assert.match(hooks, /fromMaster && specifier === "@\/data\/master\.json"/);
  assert.match(hooks, /fromMaster && specifier === "\.\/types"/);
  assert.equal((hooks.match(/shortCircuit: true/g) ?? []).length, 2);
});

// ---------- 採点 ----------
test("採点（正解の読み取り）：品質の差し替えで動かした matchTablet（補足 name_note も渡す）と、行ごとに同じ製品・候補になる。145/145", { skip }, () => {
  const out = path.join(tmp(), "s");
  const r = runScorer(["--out", out]);
  assert.equal(r.status, 0, r.stderr);
  const [h, ...rows] = parseCsv(fs.readFileSync(`${out}-rows.csv`, "utf8")).filter((x) => x.length > 1);
  const recs = rows.map((x) => Object.fromEntries(h.map((k, i) => [k, x[i]]))).filter((x) => x.source === "truth");
  assert.equal(recs.length, 145);
  const mine = match(recs.map((x) => [x.name_used, null]));
  // 規格は正解の読み取りの strength を渡すので、品質側も同じものを渡し直す
  const exp = (rx) => JSON.parse(fs.readFileSync(path.join(DATA, "expected", `${rx}.expected.json`), "utf8"));
  const item = (x) => exp(x.rx).items.find((i) => i.rp === x.rp);
  const mine2 = match(recs.map((x) => [x.name_used, item(x).strength, { nameNote: item(x).name_note }]));
  const bad = [];
  recs.forEach((x, i) => {
    if ((mine2[i].best ?? "") !== x.selected || mine2[i].candidates.length !== Number(x.candidates)) bad.push(`${x.rx} Rp${x.rp}: 採点 ${x.selected}/${x.candidates} 品質 ${mine2[i].best}/${mine2[i].candidates.length}`);
  });
  assert.deepEqual(bad, []);
  assert.ok(mine.length === 145);
  assert.match(r.stdout, /正しい 145\/145/);
});

test("採点：読み取りの誤りと選択の誤りを分ける（ノルバスクを 2.5mg と読む、rx15 の補足 12時間持続 を読み落とす＝読み取りの誤り 2、選択の誤り 0）", { skip }, () => {
  const d = tmp();
  const res = path.join(d, "res");
  fs.mkdirSync(res);
  const e8 = JSON.parse(fs.readFileSync(path.join(DATA, "expected/rx08.expected.json"), "utf8"));
  e8.items[0].name_as_written = "ノルバスク錠2.5mg"; // 正解の読み取りなら アムロジピン錠5mg「サワイ」 を選べる
  e8.items[0].strength = "2.5mg";
  fs.writeFileSync(path.join(res, "rx08__QA__t__x.json"), JSON.stringify({ result: e8 }));
  const e15 = JSON.parse(fs.readFileSync(path.join(DATA, "expected/rx15.expected.json"), "utf8"));
  e15.items.find((x) => x.rp === "03").name_note = null; // 12時間持続 を読み落とすと CR と L の候補 2 つで決まらない
  fs.writeFileSync(path.join(res, "rx15__QA__t__x.json"), JSON.stringify({ result: e15 }));
  const out = path.join(d, "s");
  const r = runScorer(["--results", res, "--out", out]);
  assert.equal(r.status, 0, r.stderr);
  const md = fs.readFileSync(`${out}.md`, "utf8");
  assert.match(md, /読み取りの誤り（正解の読み取りなら正しく選べる行） \| 2 \|/);
  assert.match(md, /選択の誤り（正解の読み取りでも選べない行） \| 0 \|/);
  assert.match(md, /rx08__QA__t__x \| 01 \| ノルバスク錠2\.5mg/);
  assert.match(md, /rx15__QA__t__x \| 03 \| 【般】ニフェジピン徐放錠10mg/);
});

test("--private：画面には数だけ。薬品名・製品の id を出さず、ファイルを書かない（--out を渡しても、--results があっても）", { skip }, () => {
  const d = tmp();
  const res = path.join(d, "res");
  fs.mkdirSync(res);
  fs.copyFileSync(path.join(DATA, "expected/rx08.expected.json"), path.join(res, "rx08__QA__t__x.json"));
  const out = path.join(d, "out", "s");
  const before = fs.existsSync(path.join(ROOT, "reports/score-adopted.md")) ? fs.statSync(path.join(ROOT, "reports/score-adopted.md")).mtimeMs : 0;
  const r = runScorer(["--private", "--results", res, "--out", out]);
  assert.equal(r.status, 0, r.stderr);
  const text = r.stdout + r.stderr;
  assert.match(text, /正しい 145\/145/);
  const names = new Set();
  for (const p of facility) for (const n of [p.brand_name, p.generic_name, p.id, ...(p.aliases ?? [])]) if (n) names.add(n);
  for (const t of parseCsv(fs.readFileSync(path.join(DATA, "expected-adopted.csv"), "utf8")).slice(1)) if (t[2]) names.add(t[2]);
  const leaked = [...names].filter((n) => text.includes(n));
  assert.deepEqual(leaked, []);
  // 薬の名前らしい文字（錠・カプセル・mg）も出ない
  assert.doesNotMatch(text, /錠|カプセル|\dmg|μg/);
  assert.equal(fs.existsSync(path.join(d, "out")), false, "--out のフォルダが作られた");
  assert.deepEqual(fs.readdirSync(res), ["rx08__QA__t__x.json"]);
  const after = fs.existsSync(path.join(ROOT, "reports/score-adopted.md")) ? fs.statSync(path.join(ROOT, "reports/score-adopted.md")).mtimeMs : 0;
  assert.equal(after, before, "reports/score-adopted.md が書き換えられた");
});

test("--private：施設のマスタの id の重複・正解の id が無い・行が無い の止まり方でも名前を出さない", { skip }, () => {
  const d = tmp();
  const dup = path.join(d, "dup.json");
  fs.writeFileSync(dup, JSON.stringify({ products: [...facility, facility[0]] }));
  let r = runScorer(["--private", "--facility", dup]);
  assert.equal(r.status, 1);
  assert.doesNotMatch(r.stdout + r.stderr, new RegExp(facility[0].brand_name.replace(/[()]/g, ".")));
  const csv = path.join(d, "e.csv");
  fs.writeFileSync(csv, "rx,rp,expected\nrx01,01,ノルバスク錠5mg\n");
  r = runScorer(["--private", "--expected-adopted", csv]);
  assert.equal(r.status, 1);
  assert.doesNotMatch(r.stdout + r.stderr, /ノルバスク/);
});

test("【不具合】--private：施設のマスタが JSON でない（CSV を渡した等）と、エラー文に中身（薬品名）が出る", { skip, todo: "JSON.parse のエラー文（Node は先頭の文字列を引用する）を --private のときは出さない" }, () => {
  const d = tmp();
  const f = path.join(d, "facility.json");
  fs.writeFileSync(f, "ノルバスク錠5mg,アムロジピン錠5mg「サワイ」\n");
  const r = runScorer(["--private", "--facility", f]);
  assert.equal(r.status, 1);
  assert.doesNotMatch(r.stdout + r.stderr, /ノルバスク|アムロジピン/);
});

test("【不具合】--private：正解の CSV が無いと、止まらずに例外（スタックトレース）で落ちる", { skip, todo: "readFileSync を try で囲み、ファイル名だけの短い文で止める" }, () => {
  const r = runScorer(["--private", "--expected-adopted", path.join(tmp(), "none.csv")]);
  assert.equal(r.status, 1);
  assert.doesNotMatch(r.stderr, /\n\s+at /);
});

// ---------- アプリの照合（feature/matching-rules。前の【アプリの不具合】8 件の行き先） ----------
test("アプリ：別名つきの先発名（ノルバスク）→ 採用の後発品、メーカー違い → 採用のメーカー、OD は OD のまま、L は L のまま", { skip }, () => {
  const r = match([
    ["ノルバスク錠5mg", "5mg"],
    ["アムロジピン錠5mg「トーワ」", "5mg"],
    ["アムロジピンOD錠5mg「トーワ」", "5mg"],
    ["ニフェジピンL錠10mg「サワイ」", "10mg"],
  ]);
  assert.deepEqual(r.map((x) => x.best), ["アムロジピン錠5mg「サワイ」", "アムロジピン錠5mg「サワイ」", "アムロジピンOD錠5mg「サワイ」", "ニフェジピンL錠10mg「トーワ」"]);
  assert.ok(r.every((x) => x.status === "採用品"));
});

test("直った：L 錠の処方で L が採用されていない規格なら CR を選ばない（ニフェジピンL錠20mg → 採用外（市販品あり））", { skip }, () => {
  const r = one("ニフェジピンL錠20mg「サワイ」", "20mg");
  assert.equal(r.best, null);
  assert.deepEqual(r.candidates, []);
  assert.equal(r.status, "採用外（市販品あり）");
});

test("直った：【般】ニフェジピン徐放錠 — 補足が無ければ候補を出すだけで選ばない。12時間持続 → L、24時間持続 → CR、12時間持続で L が無ければ CR を出さない", { skip }, () => {
  const r = match([
    ["【般】ニフェジピン徐放錠10mg", "10mg"],
    ["【般】ニフェジピン徐放錠10mg", "10mg", { nameNote: "12時間持続" }],
    ["【般】ニフェジピン徐放錠10mg", "10mg", { nameNote: "24時間持続" }],
    ["【般】ニフェジピン徐放錠20mg", "20mg"],
    ["【般】ニフェジピン徐放錠20mg", "20mg", { nameNote: "12時間持続" }],
    ["【般】ニフェジピン徐放錠20mg", "20mg", { nameNote: "24時間持続" }],
  ]);
  assert.equal(r[0].best, null);
  assert.deepEqual(r[0].candidates.sort(), ["ニフェジピンCR錠10mg「サワイ」", "ニフェジピンL錠10mg「トーワ」"]);
  assert.match(r[0].note, /12時間／24時間/);
  assert.equal(r[1].best, "ニフェジピンL錠10mg「トーワ」");
  assert.equal(r[2].best, "ニフェジピンCR錠10mg「サワイ」");
  assert.equal(r[3].best, null, "補足なし・CR だけ採用でも推し量って選ばない");
  assert.deepEqual(r[3].candidates, ["ニフェジピンCR錠20mg「サワイ」"]);
  assert.equal(r[4].best, null);
  assert.deepEqual(r[4].candidates, []);
  assert.equal(r[5].best, "ニフェジピンCR錠20mg「サワイ」");
});

test("直った：採用中止 — 販売終了（リオナ）は出さない、メーカー切替（ロキソプロフェン「サワイ」）は「以前の採用」だけで選ばない", { skip }, () => {
  const [a, b] = match([["リオナ錠250mg", "250mg"], ["ロキソプロフェンNa錠60mg「サワイ」", "60mg"]]);
  assert.equal(a.best, null);
  assert.deepEqual(a.candidates, []);
  assert.deepEqual(a.previous, []);
  assert.equal(b.best, null);
  assert.deepEqual(b.candidates, []);
  assert.deepEqual(b.previous, ["ロキソプロフェンNa錠60mg「サワイ」"]);
  assert.match(b.note, /メーカー切替/);
  for (const x of [a, b]) assert.equal(x.status, "採用外（市販品あり）");
});

test("直った：別名の無い先発名も同じ鍵の採用後発品に（リピトール・ムコスタ・マグミット・ガスモチン・アーチスト・アルダクトンA）。置き換えの一言つき", { skip }, () => {
  const r = match([["リピトール錠10mg", "10mg"], ["ムコスタ錠100mg", "100mg"], ["マグミット錠330mg", "330mg"], ["ガスモチン錠5mg", "5mg"], ["アーチスト錠10mg", "10mg"], ["アルダクトンA錠25mg", "25mg"]]);
  assert.deepEqual(r.map((x) => x.best), ["アトルバスタチン錠10mg「サワイ」", "レバミピド錠100mg「サワイ」", "酸化マグネシウム錠330mg「ヨシダ」", "モサプリドクエン酸塩錠5mg「AA」", "カルベジロール錠10mg「トーワ」", "スピロノラクトン錠25mg「トーワ」"]);
  // マグミットは厚労省の一覧で先発ではない（酸化マグネシウムは先発・後発の区別が無い）ので「先発→後発」の一言は出ない。置き換えの印は出る
  for (const x of r) { assert.equal(x.substituted, true, x.name); if (x.name !== "マグミット錠330mg") assert.match(x.note ?? "", /先発品の処方を後発品に/, x.name); }
});

test("直った：【般】アムロジピン口腔内崩壊錠5mg → アムロジピンOD錠5mg「サワイ」（ふつうの錠は選ばない）", { skip }, () => {
  const r = one("【般】アムロジピン口腔内崩壊錠5mg", "5mg");
  assert.equal(r.best, "アムロジピンOD錠5mg「サワイ」");
  assert.deepEqual(r.candidates, ["アムロジピンOD錠5mg「サワイ」"]);
});

test("直った：カプセル（徐放）の処方で OD 錠を選ばない（タムスロシン塩酸塩カプセル → 候補なし。ルール外表示のときだけ理由つきで出る）", { skip }, () => {
  const [a, b] = match([["タムスロシン塩酸塩カプセル0.2mg「サワイ」", "0.2mg"], ["タムスロシン塩酸塩カプセル0.2mg「サワイ」", "0.2mg", { includeRuleOut: true }]]);
  assert.equal(a.best, null);
  assert.deepEqual(a.candidates, []);
  assert.deepEqual(a.ruleOut, []);
  assert.deepEqual(b.ruleOut.map((x) => x[0]), ["タムスロシン塩酸塩OD錠0.2mg「サワイ」"]);
  assert.equal(b.best, null, "ルール外を表示しても自動では選ばない");
});

test("院内の決まり：ふつうの錠の処方 → 同じ成分・規格の OD 錠は選ぶ（置き換えの一言）。OD → ふつうの錠は選ばない（ルール外のときだけ理由つき）", { skip }, () => {
  const d = tmp();
  const only = (name) => { const f = path.join(d, `${name}.json`); fs.writeFileSync(f, JSON.stringify({ products: facility.filter((p) => p.brand_name === name) })); return f; };
  const od = only("アムロジピンOD錠5mg「サワイ」");
  let [r] = match([["アムロジピン錠5mg「トーワ」", "5mg"]], od);
  assert.equal(r.best, "アムロジピンOD錠5mg「サワイ」");
  assert.equal(r.substituted, true);
  assert.match(r.note ?? "", /普通の錠の処方を OD 錠に/);
  const plain = only("アムロジピン錠5mg「サワイ」");
  [r] = match([["アムロジピンOD錠5mg「トーワ」", "5mg"]], plain);
  assert.equal(r.best, null);
  assert.deepEqual(r.candidates, []);
  [r] = match([["アムロジピンOD錠5mg「トーワ」", "5mg", { includeRuleOut: true }]], plain);
  assert.deepEqual(r.ruleOut, [["アムロジピン錠5mg「サワイ」", "OD 錠の処方を普通の錠に"]]);
});
