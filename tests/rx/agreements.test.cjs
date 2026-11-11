// 施設の事前合意（みなし疑義、matchRx の options.agreements。AKI 11/11）を、柵を越えようとする合意で試す。
//   node --test tests/rx/
// 合意で外してよいのは「後発→先発」「先発・後発の区別なし」の決まりだけ。放出・カプセル↔錠・規格・OD→ふつう・YJ の上 9 桁・入れ替えない組・漢方は越えない
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { ROOT, DATA } = require("./helpers.cjs");

const tsOk = Number(process.versions.node.split(".")[0]) >= 22 && process.features?.typescript;
const skip = !tsOk && "Node の TypeScript 読み込みが無い";
const ok = (from, to, extra = {}) => ({ from, to, reason: "品質の試験（架空）", agreed_by: "品質（架空）", agreed_at: "2026-11-11", ...extra });
function agree(q) {
  const r = spawnSync(process.execPath, ["--no-warnings", path.join(__dirname, "matching/agree.mjs"), ROOT, JSON.stringify(q)], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr.slice(0, 300));
  return JSON.parse(r.stdout);
}

test("事前合意で選べる：後発→先発（ジゴキシン錠0.125mg「AFP」→ジゴシン）、メーカーなしの名前で書いた合意（アムロジピン錠5mg → ノルバスク錠5mg）。札と理由が出る。合意が無ければ選ばない", { skip }, () => {
  const r = agree([
    ["ジゴキシン錠0.125mg「AFP」", "0.125mg", "ジゴシン錠0.125mg", [ok("ジゴキシン錠0.125mg「AFP」", "ジゴシン錠0.125mg")]],
    ["アムロジピン錠5mg「サワイ」", "5mg", "ノルバスク錠5mg", [ok("アムロジピン錠5mg", "ノルバスク錠5mg")]],
    ["アムロジピン錠5mg「サワイ」", "5mg", "ノルバスク錠5mg", []],
  ]);
  assert.equal(r[0].best, "ジゴシン錠0.125mg");
  assert.ok(r[0].agreement);
  assert.match(r[0].note, /事前合意：品質の試験/);
  assert.equal(r[1].best, "ノルバスク錠5mg");
  assert.equal(r[2].best, null);
  // 例のファイル（架空）は使える形で、架空と書いてある
  const ex = JSON.parse(fs.readFileSync(path.join(DATA, "agreements.json"), "utf8"));
  assert.match(ex._説明.join(""), /架空/);
  for (const a of ex.agreements) for (const k of ["from", "to", "reason", "agreed_by", "agreed_at"]) assert.ok(a[k], k);
});

test("事前合意でも柵は越えない：CR↔L（名前・鍵・全角で書いた合意）、カプセル↔錠、規格違い、OD→ふつう、ザルティア↔シアリス（名前・鍵）、漢方の別メーカー、テノゼット↔ビリアード、ワントラム↔ツートラム、YJ の上 9 桁違い（メトホルミン「SN」→メトグルコ）、レディタブ→ふつう、短い名前の合意", { skip }, () => {
  const cases = [
    ["ニフェジピンL錠20mg「トーワ」", "20mg", "ニフェジピンCR錠20mg「サワイ」", [ok("ニフェジピンL錠20mg「トーワ」", "ニフェジピンCR錠20mg「サワイ」")]],
    ["ニフェジピンL錠20mg「トーワ」", "20mg", "ニフェジピンCR錠20mg「サワイ」", [ok("2171014F|20|L錠〔ニフェジピン〕", "ニフェジピンCR錠20mg「サワイ」")]],
    ["ニフェジピンL錠20mg「トーワ」", "20mg", "ニフェジピンCR錠20mg「サワイ」", [ok("ニフェジピンＬ錠２０ｍｇ　「トーワ」", "ニフェジピンＣＲ錠２０ｍｇ「サワイ」")]],
    ["ランソプラゾールカプセル15mg「サワイ」", "15mg", "ランソプラゾールOD錠15mg「サワイ」", [ok("ランソプラゾールカプセル15mg「サワイ」", "ランソプラゾールOD錠15mg「サワイ」")]],
    ["タケプロンカプセル15", "15mg", "ランソプラゾールOD錠15mg「サワイ」", [ok("タケプロンカプセル15", "ランソプラゾールOD錠15mg「サワイ」")]],
    ["アムロジピン錠5mg「トーワ」", "5mg", "ノルバスク錠10mg", [ok("アムロジピン錠5mg「トーワ」", "ノルバスク錠10mg")]],
    ["アムロジピン錠5mg「トーワ」", "5mg", "ノルバスク錠10mg", [ok("アムロジピン錠", "ノルバスク錠10mg")]],
    ["アムロジピンOD錠5mg「トーワ」", "5mg", "アムロジピン錠5mg「サワイ」", [ok("アムロジピンOD錠5mg「トーワ」", "アムロジピン錠5mg「サワイ」")]],
    ["ザルティア錠5mg", "5mg", "シアリス錠5mg", [ok("ザルティア錠5mg", "シアリス錠5mg")]],
    ["ザルティア錠5mg", "5mg", "シアリス錠5mg", [ok("2590016F|5|錠", "シアリス錠5mg")]],
    ["タダラフィル錠5mgZA「サワイ」", "5mg", "シアリス錠5mg", [ok("タダラフィル錠5mgZA「サワイ」", "シアリス錠5mg")]],
    ["オースギ大柴胡湯エキスT錠", "1錠", "クラシエ大柴胡湯エキス錠", [ok("オースギ大柴胡湯エキスT錠", "クラシエ大柴胡湯エキス錠")]],
    ["テノゼット錠300mg", "300mg", "ビリアード錠300mg", [ok("テノゼット錠300mg", "ビリアード錠300mg")]],
    ["ワントラム錠100mg", "100mg", "ツートラム錠100mg", [ok("ワントラム錠100mg", "ツートラム錠100mg")]],
    ["メトホルミン塩酸塩錠250mg「SN」", "250mg", "メトグルコ錠250mg", [ok("メトホルミン塩酸塩錠250mg「SN」", "メトグルコ錠250mg")]],
    ["クラリチンレディタブ錠10mg", "10mg", "ロラタジン錠10mg「サワイ」", [ok("クラリチンレディタブ錠10mg", "ロラタジン錠10mg「サワイ」")]],
  ];
  const r = agree(cases);
  for (const x of r) {
    assert.ok(!x.error, `${x.name}: ${x.error}`);
    assert.equal(x.best, null, `${x.name} → ${x.best}（${x.note}）`);
    assert.equal(x.agreement, null, x.name);
  }
});

test("【不具合】形の崩れた合意（reason・agreed_by・agreed_at が無い・空）でも自動で選び、札に「事前合意：undefined（undefined undefined）」と出る", { skip, todo: "agreementOf で from・to・reason・agreed_by・agreed_at がそろわない合意は使わない（読み込むときに、どの行が使えないかを知らせる）" }, () => {
  const r = agree([
    ["ジゴキシン錠0.125mg「AFP」", "0.125mg", "ジゴシン錠0.125mg", [{ from: "ジゴキシン錠0.125mg「AFP」", to: "ジゴシン錠0.125mg" }]],
    ["ジゴキシン錠0.125mg「AFP」", "0.125mg", "ジゴシン錠0.125mg", [{ from: "ジゴキシン錠0.125mg「AFP」", to: "ジゴシン錠0.125mg", reason: "", agreed_by: "", agreed_at: "" }]],
  ]);
  for (const x of r) assert.equal(x.best, null, `${x.best}（${x.note}）`);
});

test("【不具合】合意の一覧に null の行があると照合が例外で落ちる", { skip, todo: "agreementOf が行を null・オブジェクトでないかを見ない" }, () => {
  const [r] = agree([["ジゴキシン錠0.125mg「AFP」", "0.125mg", "ジゴシン錠0.125mg", [null]]]);
  assert.equal(r.error, undefined);
});

test("from・to の無い合意、空の合意、配列でない一覧は使わない（安全側）", { skip }, () => {
  const r = agree([
    ["ジゴキシン錠0.125mg「AFP」", "0.125mg", "ジゴシン錠0.125mg", [{ to: "ジゴシン錠0.125mg", reason: "r", agreed_by: "b", agreed_at: "x" }]],
    ["ジゴキシン錠0.125mg「AFP」", "0.125mg", "ジゴシン錠0.125mg", [ok("", "")]],
    ["ジゴキシン錠0.125mg「AFP」", "0.125mg", "ジゴシン錠0.125mg", { from: "ジゴキシン錠0.125mg「AFP」" }],
  ]);
  for (const x of r) { assert.ok(!x.error, x.error); assert.equal(x.best, null); }
});

test("【要判断】事前合意で、後発のふつうの錠 → 先発の OD 錠（YJ の上 9 桁が違う）を自動で選ぶ（ブロチゾラム錠0.25mg「サワイ」→ レンドルミンD錠0.25mg）", { skip, todo: "院内の決まり「普通→OD 可」と合意「後発→先発 可」の組み合わせ。合意は YJ の上 9 桁を越えない、という約束なら止めるべき。AKI が決める" }, () => {
  const [r] = agree([["ブロチゾラム錠0.25mg「サワイ」", "0.25mg", "レンドルミンD錠0.25mg", [ok("ブロチゾラム錠0.25mg「サワイ」", "レンドルミンD錠0.25mg")]]]);
  assert.equal(r.best, null);
});

test("総当たり：どの組にも「処方 → 採用品」の事前合意を渡しても、カプセル↔錠・放出・OD→ふつう・規格・効能違い・（OD の置き換え以外の）YJ の上 9 桁違いを自動で選ばない", { skip }, () => {
  const run = (f) => {
    const r = spawnSync(process.execPath, ["--no-warnings", path.join(__dirname, "matching", f), ROOT, "--agree"], { encoding: "utf8", maxBuffer: 1 << 26 });
    assert.equal(r.status, 0, r.stderr.slice(0, 300));
    return JSON.parse(r.stdout);
  };
  const s = run("scan.mjs");
  assert.ok(s.pairs > 20000);
  for (const [k, v] of Object.entries(s.bad)) assert.deepEqual(v, [], k);
  assert.deepEqual(run("indication.mjs").filter((x) => !x.same && x.best).map((x) => `${x.P} → ${x.F}`), []);
  const odRe = /(OD|口腔内崩壊|ザイディス|RPD|RM|(?<![A-Za-z])D|レディタブ)錠/;
  const od = (x) => odRe.test(x.replace(/「[^」]*」/g, ""));
  assert.deepEqual(run("yj9-scan.mjs").differ.filter((l) => { const [P, F] = l.split("→"); return od(P) === od(F); }), []);
});

test("先発→別の先発（AKI 11/11 に可）：自動で選ぶ組はすべて厚労省の一覧で先発どうし・YJ の上 9 桁と規格が同じ（併売品）。一覧に無いのはゾコーバの旧製品の行だけ", { skip }, () => {
  const os = spawnSync(process.execPath, ["--no-warnings", path.join(__dirname, "matching/origin-scan.mjs"), ROOT], { encoding: "utf8", maxBuffer: 1 << 26 });
  assert.equal(os.status, 0, os.stderr.slice(0, 300));
  const tmp = path.join(require("node:os").tmpdir(), `origin-scan-${process.pid}.json`);
  fs.writeFileSync(tmp, os.stdout);
  const r = spawnSync(process.execPath, ["--no-warnings", path.join(__dirname, "matching/b2b-check.mjs"), ROOT, tmp], { encoding: "utf8", maxBuffer: 1 << 26 });
  fs.rmSync(tmp, { force: true });
  const o = JSON.parse(r.stdout);
  assert.ok(o.n > 100, `組 ${o.n}`);
  assert.deepEqual(o.notListed.filter((x) => !/旧製品/.test(x.P + x.F)).map((x) => `${x.P} → ${x.F}`), []);
});
