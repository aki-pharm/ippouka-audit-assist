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

// 品質の読み（display/scan.mjs の qaOwn）：語が、規格の数字・販売名の英字・自社の「」の名前・販売名の中の 3 文字以上の連続した部分・区切りの記号だけでできていれば自身の名前。
// 販売名の中の 2 文字の剤形の語（配合・徐放）は品質の読みでは自身の名前にしないので、落ちても販売名の一部であることだけ確かめる
const FORM_OK = (x) => /^(配合|徐放)/.test(x.token) && x.token.replace(/^(配合|徐放)/, "").length <= 4 && x.product.includes(x.token.slice(0, 2));

test("親マスタの全製品：自身の名前でない語（記号・他社名・規格と違う数字）は 1 つも落とさず出す。落とすのは自身の名前の語だけ", { skip }, (t) => {
  const o = scan(), k = o.tokens;
  t.diagnostic(`製品 ${o.products}、刻印の面 ${o.sides}：${JSON.stringify(o.kinds)}。語を照らした面 ${k.sides}、落とした語 ${k.droppedTokens}`);
  assert.deepEqual(k.mismatch ?? [], [], "出した文字が元の語の順に並んでいない");
  const bad = k.droppedNotOwn.filter((x) => !FORM_OK(x));
  assert.deepEqual(bad, [], show(bad));
  t.diagnostic(`品質の読みで自身の名前にしない語のうち落ちたもの：剤形の語だけ ${k.droppedNotOwn.length} 語（${[...new Set(k.droppedNotOwn.map((x) => x.token))].join("・")}。販売名の一部）`);
  const top = Object.entries(k.droppedNoJa).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([w, c]) => `${w} ${c}`).join("、");
  t.diagnostic(`落とした英字・数字の語（すべて規格・販売名の英字・自社名）：${top} …`);
});

test("親マスタの全製品：成分名・販売名の語が 1 つも無い刻印（「JG C31」「YD 550」「5」）は、自社名・規格の数字も含め全部出す", { skip }, (t) => {
  const k = scan().tokens;
  t.diagnostic(`該当する面 ${k.wholeNoName}`);
  assert.deepEqual(k.wholeNoNameBad, []);
});

test("同じ成分・他社の名前印字を各製品に当てても、他社名・記号・違う数字の語は落ちない", { skip }, (t) => {
  const f = scan().tokens.foreign;
  const bad = f.droppedNotOwn.filter((x) => !FORM_OK(x));
  t.diagnostic(`当てた ${f.tried} 通り。落ちた語が品質の読みで自身の名前でないもの ${f.droppedNotOwnCount}（すべて剤形の語「配合」など、この製品の販売名にもある）`);
  assert.deepEqual(bad, [], show(bad));
});

test("別の成分で名前の後ろ 3 文字が同じ製品（〜サルタン・〜スタチン など）の名前印字を当てても、ほぼ隠れない（後ろ半分の決まりの確かめ）", { skip }, (t) => {
  const o = scan().tokens.otherDrug;
  const imps = [...new Set(o.droppedNotOwn.map((x) => `${x.product} ←「${x.foreignImprint}」`))];
  t.diagnostic(`当てた ${o.tried} 通り。名前印字に隠れる・語が落ちる ${imps.length} 通り：${imps.join("、")}`);
  // 既知：アトルバスタチン錠「トーワ」の片面「スタチン トーワ」を、同じトーワのシンバスタチン・ロスバスタチンに当てたときだけ（6 通り）。
  // 語はどれもその製品自身の名前の後ろ半分と自社名なので、決まりどおり名前印字（もう片面「アトルバ」で見分ける）。ほかの印字が増えたら見直す
  assert.ok(o.droppedNotOwn.every((x) => x.foreignImprint === "スタチン トーワ"), imps.join("\n"));
  assert.ok(imps.length <= 6, imps.join("\n"));
});

test("決まった例：自社の名前印字は「名前印字」、他社名だけの語（トーワの錠にオーハラ）・別の成分（アムロジピンにニフェジピン）は記号として出す", { skip }, () => {
  const c = scan().cases;
  assert.equal(c["自社の名前印字"].kind, "name");
  assert.equal(c["自社の名前印字"].summary, "名前印字");
  assert.equal(c["他社名（トーワの錠にオーハラ）"].kind, "code");
  assert.match(c["他社名（トーワの錠にオーハラ）"].summary, /オーハラ/);
  assert.equal(c["別の成分（アムロジピンにニフェジピン）"].kind, "code");
});

test("直った：名前印字に、名前・規格では説明できない英字・数字（記号）が入っていても「名前印字」に隠れる（親マスタで 0 面）", { skip }, (t) => {
  const o = scan();
  t.diagnostic(`名前印字と判定した面 ${o.nameSides} のうち、記号が隠れる面 ${o.nameWithExtraCount}（${o.nameWithExtraProducts} 製品）`);
  t.diagnostic(`参考：英字が販売名にもあるもの（「KMP」「OD」など。名前の一部か記号かは AKI の判断）${o.nameWithLatinInBrand.length} 面`);
  assert.equal(o.nameWithExtraCount, 0, show(o.nameWithExtra));
});

test("直った：決まった例：名前＋記号（「アムロジピン TW 5」）・規格と違う数字（5mg の錠に「アムロジピン 10 トーワ」）は記号として出す", { skip }, () => {
  const c = scan().cases;
  assert.equal(c["名前＋記号（記号が隠れる）"].kind, "code");
  assert.equal(c["名前＋規格と違う数字"].kind, "code");
});

test("直った：他社名の印字が、空白をはさんで成分名の後にあると「名前印字」に隠れる（JG の錠に「ラモトリギン トーワ 100」）", { skip }, (t) => {
  const o = scan();
  t.diagnostic(`同じ成分・他社の印字（他社名・記号・違う数字を含むもの）${o.crossMaker.tried} 通りのうち、名前印字に隠れる ${o.crossMaker.hiddenCount}（他社名を含むもの ${o.crossMaker.hiddenJaForeign}、${o.crossMaker.hiddenProducts} 製品）`);
  assert.equal(o.crossMaker.hiddenJaForeign, 0, show(o.crossMaker.hidden.filter((h) => h.jaForeign)));
});

test("直った：決まった例：頭 2 文字だけ同じ語は名前ではない（トーワの錠に「トーアエイヨー」、アムロジピンの錠に「アムバロ」）", { skip }, () => {
  const c = scan().cases;
  assert.equal(c["他社名・頭 2 文字だけ同じ（トーワの錠にトーアエイヨー）"].kind, "code");
  assert.equal(c["別の成分・頭 2 文字だけ同じ（アムロジピンにアムバロ）"].kind, "code");
});

test("決まった例（d051ce2 の 4 つの決まり）：出す文字に記号・他社名が残り、自身の名前の語だけが落ちる", { skip }, () => {
  const c = scan().cases;
  // 1. 成分名の語が無い刻印は全部出す
  assert.equal(c["自社名＋記号だけ（JG C31）"].summary, "JG C31／裏 なし");
  assert.equal(c["自社名＋数字だけ（YD 550）"].summary, "YD 550／裏 なし");
  // 2. 販売名の英字だけ（OD）は名前印字にしない
  assert.equal(c["英字だけ（OD）"].kind, "code");
  assert.match(c["英字だけ（OD）"].summary, /^OD 5/);
  // 3. 行で分けた名前は自身の名前。ただし前半が別の薬なら全部出す
  assert.equal(c["行で分けた名前（カンデ8 サルタン）"].kind, "name");
  assert.equal(c["後ろ半分が別の薬（ロサルタンの錠に「カンデ サルタン」）"].kind, "code");
  assert.match(c["後ろ半分が別の薬（ロサルタンの錠に「カンデ サルタン」）"].summary, /カンデ/);
  // 4. 区切りの「/」は落としてよい（名前と自社名だけ）
  assert.equal(c["区切りの「/」"].kind, "name");
  // 名前＋記号は記号を残して「（名前印字）」
  assert.equal(c["名前＋記号（SW）"].summary, "SW（名前印字）／裏 なし");
  assert.match(c["他社名（トーワの錠にオーハラ）"].summary, /^オーハラ/);
  assert.match(c["他社名・頭 2 文字だけ同じ（トーワの錠にトーアエイヨー）"].summary, /^トーアエイヨー/);
  assert.match(c["名前＋規格と違う数字"].summary, /^10/);
});
