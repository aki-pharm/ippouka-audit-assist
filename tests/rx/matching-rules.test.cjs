// 照合の決まり（lib/matching.ts、院内の決まり＝data/match-profiles.json）を、親マスタ全体で品質が独立に確かめる。
//   node --test tests/rx/
// - 走査：同じ成分（YJ 上 7 桁）・同じ規格の製品どうしを 1 対 1 で組み、施設＝1 製品だけで matchRx を呼ぶ（tests/rx/matching/scan.mjs）。
//   剤形・放出・先発後発は lib/makers.ts と match-data を使わず、販売名・YJ の 8 桁目・厚労省の一覧から品質が決める
// - 【アプリの不具合】todo：決まりに反するふるまい（アプリは直さない。直したら todo を外す）
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { ROOT } = require("./helpers.cjs");

const tsOk = Number(process.versions.node.split(".")[0]) >= 22 && process.features?.typescript;
const skip = !tsOk && "Node の TypeScript 読み込みが無い";
const node = (args) => spawnSync(process.execPath, ["--no-warnings", ...args], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 });

let scanCache;
function scan() {
  if (!scanCache) {
    const r = node([path.join(__dirname, "matching/scan.mjs"), ROOT]);
    assert.equal(r.status, 0, r.stderr.slice(0, 300));
    scanCache = JSON.parse(r.stdout);
  }
  return scanCache;
}
/** [[処方の名前, 規格, 施設の採用品の販売名, options], ...] → matchRx の結果 */
function pair(q) {
  const r = node([path.join(__dirname, "matching/pair.mjs"), ROOT, JSON.stringify(q)]);
  assert.equal(r.status, 0, r.stderr.slice(0, 300));
  return JSON.parse(r.stdout);
}

// ---------- 守られている決まり（親マスタ全体） ----------
test("走査：カプセル↔錠、放出の違い（CR・L・R・SR・腸溶・YJ の徐放など）、OD→ふつうの錠、規格違い を選ぶ・候補に出す組は 0", { skip }, (t) => {
  const r = scan();
  t.diagnostic(`組 ${r.pairs}、自動で選んだ ${r.selected}`);
  assert.ok(r.pairs > 20000);
  assert.deepEqual(r.bad.capsule_tablet, []);
  assert.deepEqual(r.bad.release, []);
  assert.deepEqual(r.bad.od_to_plain, []);
  assert.deepEqual(r.bad.strength, []);
});

test("ルール外の製品は includeRuleOut のときだけ ruleOut に出て、自動では選ばない。記録は理由と変更者が無いと作れない", { skip }, () => {
  const [a, b] = pair([
    ["アムロジピンOD錠5mg「トーワ」", "5mg", "アムロジピン錠5mg「サワイ」"],
    ["アムロジピンOD錠5mg「トーワ」", "5mg", "アムロジピン錠5mg「サワイ」", { includeRuleOut: true }],
  ]);
  assert.deepEqual([a.best, a.candidates, a.ruleOut], [null, [], []]);
  assert.deepEqual([b.best, b.candidates], [null, []]);
  assert.deepEqual(b.ruleOut, [["アムロジピン錠5mg「サワイ」", "OD 錠の処方を普通の錠に"]]);
  const src = fs.readFileSync(path.join(ROOT, "lib/matching.ts"), "utf8");
  assert.match(src, /if \(!reason\) throw/);
  assert.match(src, /if \(!by\) throw/);
});

test("決まりどおりに選ぶ：先発→後発（リピトール→アトルバスタチン）、ふつうの錠→OD（置き換えの一言）、一般名→同じ鍵", { skip }, () => {
  const [a, b, c] = pair([
    ["リピトール錠10mg", "10mg", "アトルバスタチン錠10mg「サワイ」"],
    ["アムロジピン錠5mg「トーワ」", "5mg", "アムロジピンOD錠5mg「サワイ」"],
    ["【般】アムロジピン錠5mg", "5mg", ["アムロジピン錠5mg「サワイ」", "アムロジピンOD錠5mg「サワイ」"]],
  ]);
  assert.equal(a.best, "アトルバスタチン錠10mg「サワイ」");
  assert.equal(b.best, "アムロジピンOD錠5mg「サワイ」");
  assert.match(b.note, /普通の錠の処方を OD 錠に/);
  assert.equal(c.best, "アムロジピン錠5mg「サワイ」");
});

test("後発→先発：同じ鍵で先発と正しく印のある製品は選ばない（アムロジピン錠5mg「サワイ」→ノルバスク錠5mg）", { skip }, () => {
  const [a, b] = pair([
    ["アムロジピン錠5mg「サワイ」", "5mg", "ノルバスク錠5mg"],
    ["アムロジピン錠5mg「サワイ」", "5mg", "ノルバスク錠5mg", { includeRuleOut: true }],
  ]);
  assert.equal(a.best, null);
  assert.deepEqual(b.ruleOut, [["ノルバスク錠5mg", "後発品の処方を先発品に"]]);
});

// ---------- 【アプリの不具合】後発→先発を自動で選ぶ ----------
test("【アプリの不具合】後発→先発：走査で 602 組。後発品の処方で先発品を自動で選ぶ組は 0 であるべき", { skip, todo: "下の 4 つの原因。件数は品質の走査（剤形ごとに 6 製品まで）で" }, () => {
  assert.deepEqual(scan().bad.generic_to_brand, []);
});

test("【アプリの不具合】ふつうの錠→OD 錠の置き換えで、先発後発を見ない（ブロチゾラム錠0.25mg「サワイ」→ レンドルミンD錠0.25mg を選ぶ。走査で 438 組）", { skip, todo: "plain_to_od の組にも generic_to_brand を当てる（matchRx は rel === 'same' のときだけ先発後発を見る）" }, () => {
  const [r] = pair([["ブロチゾラム錠0.25mg「サワイ」", "0.25mg", "レンドルミンD錠0.25mg"]]);
  assert.equal(r.facilityOrigin[0], "先発");
  assert.equal(r.best, null);
});

test("【アプリの不具合】先発品が「後発」の印になっている：パキシル錠10mg・コバシル・クレストールOD・オメプラゾン・ムコサール・テオロング・ネルボン など（YJ が統一名の行を指す製品。走査で 75 組）", { skip, todo: "build-maker-index.cjs の originOf：YJ が統一名（メーカーの無い行）なら、その行の印を使わず「不明」に。販売名に「」が無い製品は先発の疑い" }, () => {
  const r = pair([
    ["パロキセチン錠10mg「AA」", "10mg", "パキシル錠10mg"],
    ["ロスバスタチン錠2.5mg「DSEP」", "2.5mg", "クレストールOD錠2.5mg"],
    ["オメプラゾール錠10mg「トーワ」", "10mg", "オメプラゾン錠10mg"],
  ]);
  for (const x of r) assert.equal(x.best, null, `${x.name} → ${x.best}（先発の印 ${x.facilityOrigin[0]}）`);
});

test("【アプリの不具合】先発・後発が「不明」だと後発→先発を止めない（10mgセルシン錠：親マスタに同じ名前が 2 行、印が 先発 と 不明 で「不明」に。走査で 14 組）", { skip, todo: "不明は安全側に：処方が後発で採用品の印が不明なら自動で選ばず候補にとどめる" }, () => {
  const [r] = pair([["ジアゼパム錠10mg「ツルハラ」", "10mg", "10mgセルシン錠"]]);
  assert.equal(r.facilityOrigin[0], "不明");
  assert.equal(r.best, null);
});

test("【アプリの不具合】処方の後発品が厚労省の一覧で「どちらでもない」だと、先発を選ぶ（炭酸リチウム錠200mg「フジナガ」→ リーマス錠200 など。走査で 49 組）", { skip, todo: "販売名に「」のある処方は後発とみなす（一覧の印が両方 False でも）か、どちらでもない→先発は選ばない" }, () => {
  const [r] = pair([["炭酸リチウム錠200mg「フジナガ」", "200mg", "リーマス錠200"]]);
  assert.equal(r.best, null, `処方の印 ${r.origin} → ${r.best}（${r.facilityOrigin[0]}）`);
});

// ---------- 【アプリの不具合】決まりでは選べるのに選ばない（安全側の取りこぼし） ----------
test("【アプリの不具合】先発→後発の徐放・腸溶製剤を選ばない（アダラートCR錠20mg → ニフェジピンCR錠20mg「サワイ」 が「採用外」になり、ルール外表示では「放出の仕方が違う」と出る）", { skip, todo: "徐放の鍵に販売名の系列（〔アダラート〕〔ニフェジピン〕）が入り、同じ CR でも別の薬になる。走査で 33 組（ヘルベッサーR・ベザトールSR・アザルフィジンEN・ミラペックスLA など）" }, () => {
  const [a, b] = pair([
    ["アダラートCR錠20mg", "20mg", "ニフェジピンCR錠20mg「サワイ」"],
    ["アダラートCR錠20mg", "20mg", "ニフェジピンCR錠20mg「サワイ」", { includeRuleOut: true }],
  ]);
  assert.equal(a.best, "ニフェジピンCR錠20mg「サワイ」");
  assert.deepEqual(b.ruleOut, []);
});

// ---------- ブランドの英字の合わせ方（canonicalKey） ----------
test("ブランドの英字：アルダクトンA→スピロノラクトン錠、チラーヂンS→レボチロキシンNa錠、ガスロンN→イルソグラジン錠 は同じ薬（YJ が普通の錠）", { skip }, () => {
  const r = pair([
    ["アルダクトンA錠25mg", "25mg", "スピロノラクトン錠25mg「トーワ」"],
    ["チラーヂンS錠50μg", "50μg", "レボチロキシンNa錠50μg「サンド」"],
    ["ガスロンN錠2mg", "2mg", "イルソグラジンマレイン酸塩錠2mg「サワイ」"],
  ]);
  assert.deepEqual(r.map((x) => x.best), ["スピロノラクトン錠25mg「トーワ」", "レボチロキシンNa錠50μg「サンド」", "イルソグラジンマレイン酸塩錠2mg「サワイ」"]);
});

test("ブランドの英字：徐放を示す英字（デパケンR・セレニカR・ヘルベッサーR）は普通の錠・カプセルと合わせない", { skip }, () => {
  const r = pair([
    ["デパケンR錠200mg", "200mg", "バルプロ酸ナトリウム錠200mg「DSP」"],
    ["バルプロ酸ナトリウム錠200mg「DSP」", "200mg", "セレニカR錠200mg"],
    ["ジルチアゼム塩酸塩錠30mg「サワイ」", "30mg", "ヘルベッサー錠30"],
  ]);
  assert.equal(r[0].best, null);
  assert.equal(r[1].best, null);
  assert.deepEqual(r[0].candidates, []);
});

test("【アプリの不具合】ブランドの英字を合わせた結果、別のメーカーの漢方エキス錠を同じ薬にする（オースギ大柴胡湯エキスT錠 → クラシエ大柴胡湯エキス錠、黄連解毒湯・小青竜湯・八味地黄丸料・半夏厚朴湯も）", { skip, todo: "漢方エキス製剤はメーカーごとに 1 錠中のエキス量・1 日量が違い、互いに同じ薬ではない。規格が「1錠」なので規格でも分かれない。YJ 52xx は英字を合わせない・メーカー違いを選ばない" }, () => {
  const r = pair([
    ["オースギ大柴胡湯エキスT錠", "1錠", "クラシエ大柴胡湯エキス錠"],
    ["オースギ黄連解毒湯エキスT錠", "1錠", "クラシエ黄連解毒湯エキス錠"],
  ]);
  for (const x of r) assert.equal(x.best, null, `${x.name} → ${x.best}`);
});

// ---------- 先発・後発の印の出どころ ----------
test("先発・後発の印：不明（0）は 82 製品（作業の報告どおり）。どれも同じ名前で印のある行が別にあるか、販売名に「」が無い", () => {
  const src = fs.readFileSync(path.join(ROOT, "lib/match-data.ts"), "utf8");
  const data = JSON.parse(src.slice(src.indexOf("= {") + 2, src.lastIndexOf("}") + 1));
  const unknown = data.products.filter((p) => p[2] === 0);
  assert.equal(unknown.length, 82);
  for (const [name] of unknown) assert.doesNotMatch(name.normalize("NFKC"), /「[^」]+」/, name);
});

// ---------- 公開の安全 ----------
test("lib/match-data.ts は親マスタ（公開データ）だけから作られ、施設の採用で絞っていない", () => {
  const src = fs.readFileSync(path.join(ROOT, "lib/match-data.ts"), "utf8");
  const data = JSON.parse(src.slice(src.indexOf("= {") + 2, src.lastIndexOf("}") + 1));
  const pm = JSON.parse(fs.readFileSync(path.join(ROOT, "data/parent/parent-master.json"), "utf8")).products.filter((p) => p.status !== "none");
  assert.equal(data.products.length, pm.length, "親マスタの製品（外観の下書きの無いものを除く）がすべて入っている");
  const names = new Set(pm.map((p) => p.brand_name));
  assert.deepEqual(data.products.filter(([n]) => !names.has(n)).map(([n]) => n), [], "親マスタに無い名前（施設の名前など）が入っていない");
  assert.doesNotMatch(src.replace(/^\/\/.*$/gm, ""), /adopted|採用|maker_state|private/);
  const gen = fs.readFileSync(path.join(ROOT, "scripts/build-maker-index.cjs"), "utf8");
  assert.doesNotMatch(gen, /readFileSync\([^)]*private/);
  const git = spawnSync("git", ["ls-files", "data/private"], { cwd: ROOT, encoding: "utf8" });
  if (git.status === 0) assert.equal(git.stdout.trim(), "");
});
