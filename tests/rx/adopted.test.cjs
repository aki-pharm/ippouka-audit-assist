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

// ---------- アプリを書き換えていない ----------
test("lib/master.ts・lib/types.ts は main と同じ（採点のためにアプリの照合を書き換えていない）", () => {
  const ref = ["origin/main", "main"].find((r) => spawnSync("git", ["rev-parse", "--verify", "-q", r], { cwd: ROOT }).status === 0);
  if (!ref) return;
  for (const f of ["lib/master.ts", "lib/types.ts", "data/master.json"]) {
    assert.equal(spawnSync("git", ["diff", "--quiet", ref, "--", f], { cwd: ROOT }).status, 0, f);
  }
  // 採点の差し替えは master.json と ./types の 2 つだけ（lib/master.ts から読まれたときだけ）
  const hooks = fs.readFileSync(path.join(ROOT, "scripts/eval/adopted-hooks.mjs"), "utf8");
  assert.match(hooks, /fromMaster && specifier === "@\/data\/master\.json"/);
  assert.match(hooks, /fromMaster && specifier === "\.\/types"/);
  assert.equal((hooks.match(/shortCircuit: true/g) ?? []).length, 2);
});

// ---------- 採点 ----------
test("採点（正解の読み取り）：品質の差し替えで動かした matchTablet と、行ごとに同じ製品・候補になる", { skip }, () => {
  const out = path.join(tmp(), "s");
  const r = runScorer(["--out", out]);
  assert.equal(r.status, 0, r.stderr);
  const [h, ...rows] = parseCsv(fs.readFileSync(`${out}-rows.csv`, "utf8")).filter((x) => x.length > 1);
  const recs = rows.map((x) => Object.fromEntries(h.map((k, i) => [k, x[i]]))).filter((x) => x.source === "truth");
  assert.equal(recs.length, 145);
  const mine = match(recs.map((x) => [x.name_used, null]));
  // 規格は正解の読み取りの strength を渡すので、品質側も同じものを渡し直す
  const exp = (rx) => JSON.parse(fs.readFileSync(path.join(DATA, "expected", `${rx}.expected.json`), "utf8"));
  const mine2 = match(recs.map((x) => [x.name_used, exp(x.rx).items.find((i) => i.rp === x.rp).strength]));
  const bad = [];
  recs.forEach((x, i) => {
    if ((mine2[i].best ?? "") !== x.selected || mine2[i].candidates.length !== Number(x.candidates)) bad.push(`${x.rx} Rp${x.rp}: 採点 ${x.selected}/${x.candidates} 品質 ${mine2[i].best}/${mine2[i].candidates.length}`);
  });
  assert.deepEqual(bad, []);
  assert.ok(mine.length === 145);
  assert.match(r.stdout, /正しい 135\/145/);
});

test("採点：読み取りの誤りと選択の誤りを分ける（ノルバスクを 2.5mg と読む＝読み取りの誤り、リピトールを正しく読む＝選択の誤り）", { skip }, () => {
  const d = tmp();
  const res = path.join(d, "res");
  fs.mkdirSync(res);
  const e = JSON.parse(fs.readFileSync(path.join(DATA, "expected/rx08.expected.json"), "utf8"));
  e.items[0].name_as_written = "ノルバスク錠2.5mg"; // 正解の読み取りなら アムロジピン錠5mg「サワイ」 を選べる
  e.items[0].strength = "2.5mg";
  fs.writeFileSync(path.join(res, "rx08__QA__t__x.json"), JSON.stringify({ result: e }));
  const out = path.join(d, "s");
  const r = runScorer(["--results", res, "--out", out]);
  assert.equal(r.status, 0, r.stderr);
  const md = fs.readFileSync(`${out}.md`, "utf8");
  // rx08 は 6 行：正解の読み取りでは Rp02・04・05・06 の 4 行が選べない（別名の無い先発名）
  assert.match(md, /読み取りの誤り（正解の読み取りなら正しく選べる行） \| 1 \|/);
  assert.match(md, /選択の誤り（正解の読み取りでも選べない行） \| 4 \|/);
  assert.match(md, /rx08__QA__t__x \| 01 \| ノルバスク錠2\.5mg/);
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
  assert.match(text, /正しい 135\/145/);
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

// ---------- アプリの照合（うまくいくもの） ----------
test("アプリ：別名つきの先発名（ノルバスク）→ 採用の後発品、メーカー違い → 採用のメーカー、OD は OD のまま", { skip }, () => {
  const r = match([
    ["ノルバスク錠5mg", "5mg"],
    ["アムロジピン錠5mg「トーワ」", "5mg"],
    ["アムロジピンOD錠5mg「トーワ」", "5mg"],
    ["ニフェジピンL錠10mg「サワイ」", "10mg"],
  ]);
  assert.deepEqual(r.map((x) => x.best), ["アムロジピン錠5mg「サワイ」", "アムロジピン錠5mg「サワイ」", "アムロジピンOD錠5mg「サワイ」", "ニフェジピンL錠10mg「トーワ」"]);
});

// ---------- 【アプリの不具合】（作業の報告を品質が再現。アプリは直さない） ----------
test("【アプリの不具合】L 錠の処方で、L が採用されていない規格だと CR 錠を選ぶ（ニフェジピンL錠20mg → ニフェジピンCR錠20mg）", { skip, todo: "一般名＋規格の照合が放出（CR・L）を見ない" }, () => {
  const r = one("ニフェジピンL錠20mg「サワイ」", "20mg");
  assert.notEqual(r.best, "ニフェジピンCR錠20mg「サワイ」");
});

test("【アプリの不具合】【般】ニフェジピン徐放錠20mg（12時間持続＝L）でも CR 錠を選ぶ。補足（12/24 時間）を照合に渡せない", { skip, todo: "matchTablet は名前と規格しか受け取らず、name_note を見ない" }, () => {
  // 正解の読み取りどおり name_note は分けて渡す（アプリも同じ）。名前だけでは 12 時間か 24 時間か分からない
  const r = one("【般】ニフェジピン徐放錠20mg", "20mg");
  assert.equal(r.best, null, "12/24 時間が分からないなら選ばずに確認を求めるべき");
});

test("【アプリの不具合】【般】ニフェジピン徐放錠10mg：CR と L が両方採用だと候補 2 つで決まらない（12/24 時間の区別が無い）", { skip, todo: "name_note（24時間持続／12時間持続）で CR と L を分ける" }, () => {
  const r = one("【般】ニフェジピン徐放錠10mg", "10mg");
  assert.deepEqual(r.candidates.sort(), ["ニフェジピンCR錠10mg「サワイ」", "ニフェジピンL錠10mg「トーワ」"]);
  assert.equal(r.best, "ニフェジピンL錠10mg「トーワ」"); // rx15 Rp03 は 12 時間持続
});

test("【アプリの不具合】採用中止（adopted:false）の製品を、名前が完全に同じだと選ぶ（リオナ錠250mg、ロキソプロフェンNa錠60mg「サワイ」）", { skip, todo: "完全一致でも採用中止なら選ばない（採用なしとして知らせる）" }, () => {
  const r = match([["リオナ錠250mg", "250mg"], ["ロキソプロフェンNa錠60mg「サワイ」", "60mg"]]);
  for (const x of r) {
    assert.equal(x.bestAdopted === false, false, `${x.name} → 採用中止の ${x.best}`);
  }
});

test("【アプリの不具合】別名の無い先発名は後発品にたどり着かず「該当なし」（リピトール・ムコスタ・マグミット・ガスモチン・アーチスト・アルダクトンA）", { skip, todo: "先発名→一般名の対応（YJ コードの先頭 9 桁など）が無い。いまは施設が別名を手で入れたものだけ" }, () => {
  const r = match([["リピトール錠10mg", "10mg"], ["ムコスタ錠100mg", "100mg"], ["マグミット錠330mg", "330mg"], ["ガスモチン錠5mg", "5mg"], ["アーチスト錠10mg", "10mg"], ["アルダクトンA錠25mg", "25mg"]]);
  assert.deepEqual(r.map((x) => x.best), ["アトルバスタチン錠10mg「サワイ」", "レバミピド錠100mg「サワイ」", "酸化マグネシウム錠330mg「ヨシダ」", "モサプリドクエン酸塩錠5mg「AA」", "カルベジロール錠10mg「トーワ」", "スピロノラクトン錠25mg「トーワ」"]);
});

test("【アプリの不具合】【般】アムロジピン口腔内崩壊錠5mg が「該当なし」（採用の アムロジピンOD錠5mg「サワイ」 にたどり着かない）", { skip, todo: "一般名処方の剤形「口腔内崩壊錠」を OD 錠と結びつけていない（baseName が「アムロジピン口腔内崩壊」になる）" }, () => {
  const r = one("【般】アムロジピン口腔内崩壊錠5mg", "5mg");
  assert.equal(r.best, "アムロジピンOD錠5mg「サワイ」");
});

// 品質が見つけた、同じ根（一般名＋規格の照合が剤形を見ない）の別の形
test("【アプリの不具合】ふつうの錠の処方で OD 錠を選ぶ（ランソプラゾール錠15mg → ランソプラゾールOD錠15mg）", { skip, todo: "一般名＋規格の照合が OD とふつうの錠を区別しない" }, () => {
  const r = one("ランソプラゾール錠15mg「トーワ」", "15mg");
  assert.notEqual(r.best, "ランソプラゾールOD錠15mg「武田テバ」");
});

test("【アプリの不具合】カプセルの処方で OD 錠を選ぶ（タムスロシン塩酸塩カプセル0.2mg → タムスロシン塩酸塩OD錠0.2mg）", { skip, todo: "一般名＋規格の照合が剤形（カプセル／錠）を見ない" }, () => {
  const r = one("タムスロシン塩酸塩カプセル0.2mg「サワイ」", "0.2mg");
  assert.notEqual(r.best, "タムスロシン塩酸塩OD錠0.2mg「サワイ」");
});
