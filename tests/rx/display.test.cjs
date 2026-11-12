// lib/display.ts（画面に出す刻印の見せ方）を品質が試す。名前印字（imprintKind = "name"）は文字を出さず「名前印字」とだけ出すので、
// 見分けに使う記号・番号や、この製品の名前ではない印字（他社の印字）が「名前印字」に隠れていないかを、親マスタの全製品と決まった例で確かめる。
//   node --test tests/rx/
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { ROOT } = require("./helpers.cjs");

const tsOk = Number(process.versions.node.split(".")[0]) >= 22 && process.features?.typescript;
const skip = !tsOk && "Node の TypeScript 読み込みが無い";
let cache;
const scan = () => {
  if (cache) return cache;
  const r = spawnSync(process.execPath, ["--no-warnings", path.join(__dirname, "display/scan.mjs"), ROOT], { encoding: "utf8", maxBuffer: 1 << 28 });
  assert.equal(r.status, 0, r.stderr.slice(0, 300));
  return (cache = JSON.parse(r.stdout));
};
const show = (xs, k = 12) => xs.slice(0, k).map((x) => `${x.product}：「${x.imprint ?? x.foreignImprint}」→ ${x.summary ?? x.why ?? ""}`).join("\n");

test("親マスタの全製品：記号と判定した刻印は、一覧の 1 行（imprintSummary）に必ず出る", { skip }, (t) => {
  const o = scan();
  t.diagnostic(`製品 ${o.products}、刻印の面 ${o.sides}：${JSON.stringify(o.kinds)}`);
  assert.deepEqual(o.codeNotShown ?? [], []);
});

test("決まった例：自社の名前印字は「名前印字」、他社名だけの語（トーワの錠にオーハラ）・別の成分（アムロジピンにニフェジピン）は記号として出す", { skip }, () => {
  const c = scan().cases;
  assert.equal(c["自社の名前印字"].kind, "name");
  assert.equal(c["自社の名前印字"].summary, "名前印字");
  assert.equal(c["他社名（トーワの錠にオーハラ）"].kind, "code");
  assert.match(c["他社名（トーワの錠にオーハラ）"].summary, /オーハラ/);
  assert.equal(c["別の成分（アムロジピンにニフェジピン）"].kind, "code");
});

test("【不具合】名前印字に、名前・規格では説明できない英字・数字（記号）が入っていても「名前印字」に隠れる（親マスタで 0 面であること）", { skip, todo: "lib/display.ts は かな・漢字の語だけを見て、英字・数字を見ない" }, (t) => {
  const o = scan();
  t.diagnostic(`名前印字と判定した面 ${o.nameSides} のうち、記号が隠れる面 ${o.nameWithExtraCount}（${o.nameWithExtraProducts} 製品）`);
  t.diagnostic(`参考：英字が販売名にもあるもの（「KMP」「OD」など。名前の一部か記号かは AKI の判断）${o.nameWithLatinInBrand.length} 面`);
  assert.equal(o.nameWithExtraCount, 0, show(o.nameWithExtra));
});

test("【不具合】決まった例：名前＋記号（「アムロジピン TW 5」）・規格と違う数字（5mg の錠に「アムロジピン 10 トーワ」）は記号として出す", { skip, todo: "英字・数字を見ない" }, () => {
  const c = scan().cases;
  assert.equal(c["名前＋記号（記号が隠れる）"].kind, "code");
  assert.equal(c["名前＋規格と違う数字"].kind, "code");
});

test("【不具合】他社名の印字が、空白をはさんで成分名の後にあると「名前印字」に隠れる（JG の錠に「ラモトリギン トーワ 100」）", { skip, todo: "空白を消してから語に分けるので「ラモトリギントーワ」が 1 語になり、頭 2 文字「ラモ」だけで名前とみなす" }, (t) => {
  const o = scan();
  t.diagnostic(`同じ成分・他社の印字（他社名・記号・違う数字を含むもの）${o.crossMaker.tried} 通りのうち、名前印字に隠れる ${o.crossMaker.hiddenCount}（他社名を含むもの ${o.crossMaker.hiddenJaForeign}、${o.crossMaker.hiddenProducts} 製品）`);
  assert.equal(o.crossMaker.hiddenJaForeign, 0, show(o.crossMaker.hidden.filter((h) => h.jaForeign)));
});

test("【不具合】決まった例：頭 2 文字だけ同じ語は名前ではない（トーワの錠に「トーアエイヨー」、アムロジピンの錠に「アムバロ」）", { skip, todo: "語の頭 2 文字だけを販売名・メーカー名と比べる" }, () => {
  const c = scan().cases;
  assert.equal(c["他社名・頭 2 文字だけ同じ（トーワの錠にトーアエイヨー）"].kind, "code");
  assert.equal(c["別の成分・頭 2 文字だけ同じ（アムロジピンにアムバロ）"].kind, "code");
});
