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
test("直った：後発→先発（前は走査で 602 組）。後発品の処方で先発品を自動で選ぶ組は 0", { skip }, () => {
  assert.deepEqual(scan().bad.generic_to_brand, []);
});

test("直った：ふつうの錠→OD 錠の置き換えで、先発後発を見ない（ブロチゾラム錠0.25mg「サワイ」→ レンドルミンD錠0.25mg を選ぶ。走査で 438 組）", { skip }, () => {
  const [r] = pair([["ブロチゾラム錠0.25mg「サワイ」", "0.25mg", "レンドルミンD錠0.25mg"]]);
  assert.equal(r.facilityOrigin[0], "先発");
  assert.equal(r.best, null);
});

test("直った：先発品が「後発」の印になっている：パキシル錠10mg・コバシル・クレストールOD・オメプラゾン・ムコサール・テオロング・ネルボン など（YJ が統一名の行を指す製品。走査で 75 組）", { skip }, () => {
  const r = pair([
    ["パロキセチン錠10mg「AA」", "10mg", "パキシル錠10mg"],
    ["ロスバスタチン錠2.5mg「DSEP」", "2.5mg", "クレストールOD錠2.5mg"],
    ["オメプラゾール錠10mg「トーワ」", "10mg", "オメプラゾン錠10mg"],
  ]);
  for (const x of r) assert.equal(x.best, null, `${x.name} → ${x.best}（先発の印 ${x.facilityOrigin[0]}）`);
});

test("直った：採用品の先発・後発が「不明」なら、どの処方からも自動で選ばない（印の数は決め方で変わるので数ではなく走査で見る）", { skip }, () => {
  const r = node([path.join(__dirname, "matching/origin-scan.mjs"), ROOT]);
  assert.equal(r.status, 0, r.stderr.slice(0, 300));
  const o = JSON.parse(r.stdout);
  assert.ok(o.pairs > 100, `採用品が不明の組 ${o.pairs}`);
  assert.deepEqual(o.unknownSelected, []);
  // 前に「不明」だった 10mgセルシン錠：後発の処方からは選ばない
  const [c] = pair([["ジアゼパム錠10mg「ツルハラ」", "10mg", "10mgセルシン錠"]]);
  assert.equal(c.best, null);
});

test("直った：処方の後発品が厚労省の一覧で「どちらでもない」だと、先発を選ぶ（炭酸リチウム錠200mg「フジナガ」→ リーマス錠200 など。走査で 49 組）", { skip }, () => {
  const [r] = pair([["炭酸リチウム錠200mg「フジナガ」", "200mg", "リーマス錠200"]]);
  assert.equal(r.best, null, `処方の印 ${r.origin} → ${r.best}（${r.facilityOrigin[0]}）`);
});

// ---------- 【アプリの不具合】決まりでは選べるのに選ばない（安全側の取りこぼし） ----------
test("直った：先発→後発の徐放・腸溶製剤を選ばない（アダラートCR錠20mg → ニフェジピンCR錠20mg「サワイ」 が「採用外」になり、ルール外表示では「放出の仕方が違う」と出る）", { skip }, () => {
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

test("直った：ブランドの英字を合わせた結果、別のメーカーの漢方エキス錠を同じ薬にする（オースギ大柴胡湯エキスT錠 → クラシエ大柴胡湯エキス錠、黄連解毒湯・小青竜湯・八味地黄丸料・半夏厚朴湯も）", { skip }, () => {
  const r = pair([
    ["オースギ大柴胡湯エキスT錠", "1錠", "クラシエ大柴胡湯エキス錠"],
    ["オースギ黄連解毒湯エキスT錠", "1錠", "クラシエ黄連解毒湯エキス錠"],
  ]);
  for (const x of r) assert.equal(x.best, null, `${x.name} → ${x.best}`);
});

// ---------- 先発・後発の印の出どころ ----------
test("先発・後発の印：無作為の 先発 20 件は厚労省の一覧でも先発、不明 20 件は一覧に販売名が無い（統一名の行か一覧に無い）。不明の製品に「」つきは無い", { skip }, () => {
  const src = fs.readFileSync(path.join(ROOT, "lib/match-data.ts"), "utf8");
  const data = JSON.parse(src.slice(src.indexOf("= {") + 2, src.lastIndexOf("}") + 1));
  const csv = fs.readdirSync(path.join(ROOT, "data/parent")).find((f) => /^naifuku-tablets-.*\.csv$/.test(f));
  const nk = (x) => String(x ?? "").normalize("NFKC").replace(/[\s　®]/g, "").toLowerCase();
  const official = new Map();
  for (const l of fs.readFileSync(path.join(ROOT, "data/parent", csv), "utf8").split("\n").slice(1)) {
    const c = l.match(/("([^"]*)"|[^,]*)(,|$)/g)?.map((x) => x.replace(/,$/, "").replace(/^"|"$/g, ""));
    if (c && c[3]) official.set(nk(c[3]), { original: c[7] === "True", generic: c[6] === "True" });
  }
  let seed = 20261111;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const sample = (arr, n) => { const a = [...arr], out = []; while (out.length < n && a.length) out.push(a.splice(Math.floor(rnd() * a.length), 1)[0]); return out; };
  const brands = sample(data.products.filter((x) => x[2] === 1), 20);
  const bad = brands.filter(([n]) => official.get(nk(n))?.original !== true).map(([n]) => n);
  assert.deepEqual(bad, [], "先発の印なのに一覧で先発でない");
  const unknown = data.products.filter((x) => x[2] === 0);
  assert.ok(unknown.length > 0);
  const listed = sample(unknown, 20).filter(([n]) => official.has(nk(n))).map(([n]) => n);
  assert.deepEqual(listed, [], "不明の印なのに一覧に同じ販売名がある");
  for (const [name] of unknown) assert.doesNotMatch(name.normalize("NFKC"), /「[^」]+」/, name);
});

// ---------- 公開の安全 ----------
test("lib/match-data.ts は親マスタ（公開データ）だけから作られ、施設の採用で絞っていない", () => {
  const src = fs.readFileSync(path.join(ROOT, "lib/match-data.ts"), "utf8");
  const data = JSON.parse(src.slice(src.indexOf("= {") + 2, src.lastIndexOf("}") + 1));
  const pm = JSON.parse(fs.readFileSync(path.join(ROOT, "data/parent/parent-master.json"), "utf8")).products.filter((p) => p.status !== "none");
  // 親マスタの製品（外観の下書きの無いものを除く）がすべて入っている。入っていないのは製品でない行（患者向け・医療従事者向けの資材など）だけ
  const inData = new Set(data.products.map(([n]) => n));
  const left = pm.filter((p) => !inData.has(p.brand_name)).map((p) => p.brand_name);
  assert.ok(left.length <= 20, `入っていない ${left.length}`);
  // 製品でない行の品質の読み方（文の形・資材の言葉）。作業側の NOT_PRODUCT とは別に書いた
  const material = /患者|ご家族|皆様|みなさま|方へ|へ$|医療従事者|資材|携帯カード|適正|運用手順|ガイド|お願い|注意いただきたい|ください|いただく|にあたって|との併用|について|治療を受け|服用され/;
  for (const n of left) assert.match(n.normalize("NFKC"), material, `製品なのに入っていない: ${n}`);
  assert.ok(data.products.length >= 7000, `製品 ${data.products.length}`);
  const names = new Set(pm.map((p) => p.brand_name));
  assert.deepEqual(data.products.filter(([n]) => !names.has(n)).map(([n]) => n), [], "親マスタに無い名前（施設の名前など）が入っていない");
  assert.doesNotMatch(src.replace(/^\/\/.*$/gm, ""), /adopted|採用|maker_state|private/);
  const gen = fs.readFileSync(path.join(ROOT, "scripts/build-maker-index.cjs"), "utf8");
  assert.doesNotMatch(gen, /readFileSync\([^)]*private/);
  const git = spawnSync("git", ["ls-files", "data/private"], { cwd: ROOT, encoding: "utf8" });
  if (git.status === 0) assert.equal(git.stdout.trim(), "");
});

// ---------- 効能違いの印（YJ の上 9 桁で先発→後発をつなぐようになった：40539ba） ----------
test("効能違いの印：各先発品は自分の後発品だけに（トレリーフ→TRE、エクセグラン→EX・印なし、レバチオ→RE、バイアグラ→RE でない、アドシルカ→AD、ザルティア→ZA、メトグルコ→MT、アボルブ→AV）", { skip }, () => {
  const r = node([path.join(__dirname, "matching/indication.mjs"), ROOT]);
  assert.equal(r.status, 0, r.stderr.slice(0, 300));
  const rows = JSON.parse(r.stdout);
  const picks = (P) => [...new Set(rows.filter((x) => x.P === P && x.best).map((x) => x.F.replace(/「[^」]*」/, "")))].sort();
  assert.deepEqual(picks("トレリーフOD錠25mg"), ["ゾニサミドOD錠25mgTRE"]);
  assert.deepEqual(picks("エクセグラン錠100mg"), ["ゾニサミド錠100mg", "ゾニサミド錠100mgEX"]);
  assert.deepEqual(picks("レバチオ錠20mg"), ["シルデナフィル錠20mgRE"]);
  assert.deepEqual(picks("バイアグラ錠50mg"), []);
  assert.deepEqual(picks("アドシルカ錠20mg"), ["タダラフィル錠20mgAD"]);
  assert.ok(picks("ザルティア錠5mg").includes("タダラフィル錠5mgZA"));
  assert.deepEqual(picks("シアリス錠20mg"), [], "シアリス 20mg → AD を選ばない");
  assert.ok(!picks("シアリス錠5mg").includes("タダラフィル錠5mgZA"), "シアリス 5mg → ZA を選ばない");
  assert.ok(picks("メトグルコ錠250mg").includes("メトホルミン塩酸塩錠250mgMT"));
  assert.ok(!picks("グリコラン錠250mg").includes("メトホルミン塩酸塩錠250mgMT"), "グリコラン → MT を選ばない");
  assert.deepEqual(picks("アボルブカプセル0.5mg"), ["デュタステリドカプセル0.5mgAV"]);
});

test("直った：効能違い：ザルティア錠5mg（前立腺肥大の排尿障害）↔ シアリス錠5mg（ED）を互いに自動で選ぶ。同じ鍵の先発→先発", { skip }, () => {
  const r = pair([["ザルティア錠5mg", "5mg", "シアリス錠5mg"], ["シアリス錠5mg", "5mg", "ザルティア錠5mg"]]);
  for (const x of r) assert.equal(x.best, null, `${x.name} → ${x.best}`);
});

test("直った：効能違い：メトグルコ錠250mg → メトホルミン塩酸塩錠250mg「SN」（グリコランの後発。MT の印なし）を自動で選ぶ", { skip }, () => {
  const [r] = pair([["メトグルコ錠250mg", "250mg", "メトホルミン塩酸塩錠250mg「SN」"]]);
  assert.equal(r.best, null);
});

test("直った：OD→普通：クラリチンレディタブ錠10mg（口腔内崩壊錠）→ クラリチン錠10mg・ロラタジン錠10mg「サワイ」を自動で選ぶ", { skip }, () => {
  const r = pair([["クラリチンレディタブ錠10mg", "10mg", "クラリチン錠10mg"], ["クラリチンレディタブ錠10mg", "10mg", "ロラタジン錠10mg「サワイ」"]]);
  for (const x of r) assert.equal(x.best, null, `${x.name} → ${x.best}`);
});

test("直った：放出の違い：ワントラム錠100mg（1 日 1 回）↔ ツートラム錠100mg（1 日 2 回）を互いに自動で選ぶ", { skip }, () => {
  const r = pair([["ワントラム錠100mg", "100mg", "ツートラム錠100mg"], ["ツートラム錠100mg", "100mg", "ワントラム錠100mg"]]);
  for (const x of r) assert.equal(x.best, null, `${x.name} → ${x.best}`);
});

test("直った：親マスタの誤り：アマルエット配合錠4番「ケミファ」の規格が「1番（アムロジピン2.5mg/アトルバスタチン5mg）」で、1番「ケミファ」を自動で選ぶ", { skip }, () => {
  const [r] = pair([["アマルエット配合錠4番「ケミファ」", null, "アマルエット配合錠1番「ケミファ」"]]);
  assert.equal(r.best, null);
  assert.deepEqual(r.candidates, [], "4 番と 1 番は規格違い：候補にも出ない");
});

test("直った（候補にとどめる。入れ替えてよいかは AKI）：テノゼット錠300mg（B 型肝炎）↔ ビリアード錠300mg（HIV）を互いに自動で選ぶ。YJ の上 9 桁も同じ（6250024F1）", { skip }, () => {
  const r = pair([["テノゼット錠300mg", "300mg", "ビリアード錠300mg"]]);
  assert.equal(r[0].best, null);
});

// ---------- 29b5729：YJ の上 9 桁が自動選択の必要条件に。例外の道（普通→OD、一般名処方）を確かめる ----------
test("効能違いの全 1,298 組：別の系列の製品を自動で選ぶ組は 0", { skip }, () => {
  const r = node([path.join(__dirname, "matching/indication.mjs"), ROOT]);
  assert.equal(r.status, 0, r.stderr.slice(0, 300));
  const rows = JSON.parse(r.stdout);
  assert.ok(rows.length > 1000);
  assert.deepEqual(rows.filter((x) => !x.same && x.best).map((x) => `${x.P} → ${x.F}`), []);
});

test("自動で選んだ組のうち、OD の置き換え以外で YJ の上 9 桁が違う組は 0。先発→別の先発の自動選択も 0（AKI が決めるまで候補）", { skip }, () => {
  const r = node([path.join(__dirname, "matching/yj9-scan.mjs"), ROOT]);
  assert.equal(r.status, 0, r.stderr.slice(0, 300));
  const { differ } = JSON.parse(r.stdout);
  const odRe = /(OD|口腔内崩壊|ザイディス|RPD|RM|(?<![A-Za-z])D|レディタブ)錠/;
  const od = (s) => odRe.test(s.replace(/「[^」]*」/g, ""));
  assert.deepEqual(differ.filter((l) => { const [P, F] = l.split("→"); return od(P) === od(F); }), []);
  const o = JSON.parse(node([path.join(__dirname, "matching/origin-scan.mjs"), ROOT]).stdout);
  assert.deepEqual(o.brandToBrand, []);
  assert.deepEqual(o.unknownSelected, []);
});

test("YJ の上 9 桁の直し：統一名の行の選び直し・同じ名前の製品からの補いは、厚労省の一覧の剤形・規格と合う", { skip }, () => {
  const r = node([path.join(__dirname, "matching/yj-repair.mjs"), ROOT]);
  assert.equal(r.status, 0, r.stderr.slice(0, 300));
  const o = JSON.parse(r.stdout);
  assert.ok(o.repicks > 500 && o.fills > 30, JSON.stringify({ repicks: o.repicks, fills: o.fills }));
  assert.deepEqual(o.bad, []);
});

test("例外の道 普通→OD：効能・先発後発をまたがない（シアリス錠5mg → タダラフィルOD錠5mgZA は選ばない、ブロチゾラム「サワイ」→ レンドルミンD は選ばない、レンドルミン → ブロチゾラムOD は選ぶ）", { skip }, () => {
  const r = pair([
    ["シアリス錠5mg", "5mg", "タダラフィルOD錠5mgZA「トーワ」"],
    ["ブロチゾラム錠0.25mg「サワイ」", "0.25mg", "レンドルミンD錠0.25mg"],
    ["レンドルミン錠0.25mg", "0.25mg", "ブロチゾラムOD錠0.25mg「JG」"],
    ["【般】ロラタジン錠10mg", "10mg", "クラリチンレディタブ錠10mg"],
  ]);
  assert.equal(r[0].best, null);
  assert.equal(r[1].best, null);
  assert.equal(r[2].best, "ブロチゾラムOD錠0.25mg「JG」");
  assert.match(r[2].note, /普通の錠の処方を OD 錠に/);
  assert.equal(r[3].best, "クラリチンレディタブ錠10mg");
});

test("例外の道 一般名処方：効能で分かれない成分は正しく選ぶ（【般】メトホルミン塩酸塩錠250mg → グリコラン、MT は選ばない。【般】シルデナフィル錠50mg → バイアグラ）", { skip }, () => {
  const r = pair([
    ["【般】メトホルミン塩酸塩錠250mg", "250mg", "グリコラン錠250mg"],
    ["【般】メトホルミン塩酸塩錠250mg", "250mg", "メトホルミン塩酸塩錠250mgMT「トーワ」"],
    ["【般】シルデナフィル錠50mg", "50mg", "バイアグラ錠50mg"],
  ]);
  assert.equal(r[0].best, "グリコラン錠250mg");
  assert.equal(r[1].best, null);
  assert.equal(r[2].best, "バイアグラ錠50mg");
});

test("直った：一般名処方の道は効能違いを見ない：【般】タダラフィル錠5mg → ザルティア錠5mg（排尿障害）・シアリス錠5mg（ED）のどちらでも自動で選ぶ", { skip }, () => {
  const r = pair([["【般】タダラフィル錠5mg", "5mg", "ザルティア錠5mg"], ["【般】タダラフィル錠5mg", "5mg", "シアリス錠5mg"]]);
  for (const x of r) assert.equal(x.best, null, `${x.name} → ${x.best}`);
});

test("直った：一般名処方の道は用法違いを見ない：【般】トラマドール塩酸塩徐放錠100mg → ワントラム（1 日 1 回）・ツートラム（1 日 2 回）のどちらでも自動で選ぶ", { skip }, () => {
  const r = pair([["【般】トラマドール塩酸塩徐放錠100mg", "100mg", "ワントラム錠100mg"], ["【般】トラマドール塩酸塩徐放錠100mg", "100mg", "ツートラム錠100mg"]]);
  for (const x of r) assert.equal(x.best, null, `${x.name} → ${x.best}`);
});

test("直った：一般名処方の道は例外の組（match-exceptions.json）を見ない：【般】テノホビル ジソプロキシルフマル酸塩錠300mg → ビリアード（HIV）・テノゼット（B 型肝炎）を自動で選ぶ", { skip }, () => {
  const r = pair([["【般】テノホビル ジソプロキシルフマル酸塩錠300mg", "300mg", "ビリアード錠300mg"], ["【般】テノホビルジソプロキシルフマル酸塩錠300mg", "300mg", "テノゼット錠300mg"]]);
  for (const x of r) assert.equal(x.best, null, `${x.name} → ${x.best}`);
});

test("【不具合】製品でない行が照合のデータに残る：「オンジェンティス錠を適正にご使用いただくために」", { todo: "NOT_PRODUCT に「ご使用いただく」が無い（品質の読み方：文の形の名前）" }, () => {
  const src = fs.readFileSync(path.join(ROOT, "lib/match-data.ts"), "utf8");
  const data = JSON.parse(src.slice(src.indexOf("= {") + 2, src.lastIndexOf("}") + 1));
  const material = /患者|ご家族|皆様|みなさま|方へ|へ$|医療従事者|資材|携帯カード|適正|運用手順|ガイド|お願い|注意いただきたい|ください|いただく|にあたって|との併用|について|治療を受け|服用され/;
  assert.deepEqual(data.products.map(([n]) => n).filter((n) => material.test(n.normalize("NFKC"))), []);
});

test("直った：一般名処方の道の走査：同じ鍵に YJ の上 9 桁の違う製品がある成分で、【般】から自動で選ぶのは、印の無い系列の製品だけ（【般】メトホルミン塩酸塩錠250mg → グリコランの系列。メトグルコ・MT は選ばない。レナデックス・ザルティア・シアリスは選ばない）", { skip }, () => {
  const r = node([path.join(__dirname, "matching/general-scan.mjs"), ROOT]);
  assert.equal(r.status, 0, r.stderr.slice(0, 300));
  const { selected } = JSON.parse(r.stdout);
  // ジアゼパムは親マスタの古い YJ の重複（同じ製品）なので除く
  const rest = selected.filter((l) => !/ジアゼパム/.test(l));
  for (const l of rest) assert.match(l, /^【般】メトホルミン塩酸塩錠250mg → (グリコラン錠250mg|メトホルミン塩酸塩錠250mg「[^」]+」)（3962002F1／/, l);
  const m = pair([
    ["【般】メトホルミン塩酸塩錠250mg", "250mg", "メトグルコ錠250mg"],
    ["【般】メトホルミン塩酸塩錠250mg", "250mg", "メトホルミン塩酸塩錠250mgMT「トーワ」"],
    ["【般】メトホルミン塩酸塩錠250mg", "250mg", "メトホルミン塩酸塩錠250mg「SN」"],
    ["【般】デキサメタゾン錠4mg", "4mg", "レナデックス錠4mg"],
  ]);
  assert.equal(m[0].best, null);
  assert.equal(m[1].best, null);
  assert.equal(m[2].best, "メトホルミン塩酸塩錠250mg「SN」");
  assert.equal(m[3].best, null);
});

// ---------- 1a15793：一般名処方の総当たり（品質の剤形の読み方で、名前の剤形と違う製品を選ばないか） ----------
test("【アプリの不具合】一般名処方の総当たり（15,600 の【般】の名前 × 同じ成分・規格の全製品）：「徐放錠」の名前で、徐放でない製品（MT・AV・ZA・AD・RE・EX・NX などの印つきの普通の錠、粒状錠・分散錠・速崩錠・バッカル錠）を自動で選ぶ（73 組）", { skip, todo: "lib/matching.ts の generalName：徐放錠の絞り込みが「PLAIN に無い剤形」を通すので、錠/MT・KY錠・粒状錠・分散錠・速崩錠・バッカル錠も徐放扱いになる。放出の印（form-markers.json の release）か YJ の徐放で絞る" }, () => {
  const r = node([path.join(__dirname, "matching/general-sweep.mjs"), ROOT]);
  assert.equal(r.status, 0, r.stderr.slice(0, 300));
  const o = JSON.parse(r.stdout);
  assert.ok(o.names > 10000);
  assert.deepEqual(o.bad, []);
  assert.deepEqual(o.badCandidates, []);
});

test("【アプリの不具合】麻薬の徐放と速放：【般】オキシコドン徐放錠2.5mg → オキシコドン錠2.5mgNX「第一三共」（速放錠）を自動で選ぶ。5mg では速放錠を候補に出す", { skip, todo: "上と同じ原因（錠/NX が徐放扱い）。徐放の処方に速放錠は候補にも出さない" }, () => {
  const [a, b] = pair([["【般】オキシコドン徐放錠2.5mg", "2.5mg", "オキシコドン錠2.5mgNX「第一三共」"], ["【般】オキシコドン徐放錠5mg", "5mg", "オキシコドン錠5mgNX「第一三共」"]]);
  assert.equal(a.best, null);
  assert.deepEqual(a.candidates, []);
  assert.deepEqual(b.candidates, []);
});

test("一般名処方の剤形：腸溶錠は候補どまり、配合錠・漢方は自動で選ばない、口腔内崩壊錠は OD だけ、補足 24時間持続 は CR だけ（L は選ばない）", { skip }, () => {
  const r = pair([
    ["【般】アスピリン腸溶錠100mg", "100mg", "バイアスピリン錠100mg"],
    ["【般】カンデサルタンシレキセチル・アムロジピンベシル酸塩配合錠", "HD", "ユニシア配合錠HD"],
    ["【般】葛根湯エキス錠", "1錠", "オースギ葛根湯エキスT錠"],
    ["【般】ランソプラゾール腸溶性口腔内崩壊錠15mg", "15mg", "タケプロンOD錠15"],
    ["【般】アムロジピン口腔内崩壊錠5mg", "5mg", "アムロジピン錠5mg「サワイ」"],
    ["【般】ニフェジピン徐放錠20mg", "20mg", "アダラートCR錠20mg", { nameNote: "24時間持続" }],
    ["【般】ニフェジピン徐放錠20mg", "20mg", "ニフェジピンL錠20mg「トーワ」", { nameNote: "24時間持続" }],
    ["【般】ニフェジピン徐放錠20mg", "20mg", "ニフェジピンCR錠20mg「サワイ」", { nameNote: "12時間持続" }],
  ]);
  assert.deepEqual(r.map((x) => x.best), [null, null, null, "タケプロンOD錠15", null, "アダラートCR錠20mg", null, null]);
  assert.deepEqual(r[0].candidates, ["バイアスピリン錠100mg"]);
});

test("【不具合】一般名処方の補足「12～24時間持続」（テオフィリン徐放錠の一般名）で、親マスタに製品があるのに「該当なし」と出る", { skip, todo: "general_release_notes が「24時間」を含むので CR に絞られ、テオフィリンの徐放錠が 0 になる。安全側だが、該当なしでは市販品が無いと読める。「12～24時間」は放出の型を決めない補足として扱う" }, () => {
  const [r] = pair([["【般】テオフィリン徐放錠100mg", "100mg", "テオドール錠100mg", { nameNote: "12～24時間持続" }]]);
  assert.notEqual(r.status, "該当なし");
});
