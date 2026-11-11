// 3. drugKey・formOf・strengthKey（錠／OD錠／カプセル／チュアブル錠／ODフィルムの区別、規格の書き方の正規化）
import test from "node:test";
import assert from "node:assert/strict";
import { imp, readJson } from "./_setup.mjs";

const { drugKey, formOf, strengthKey } = await imp("lib/makers.ts");
const index = readJson("data/parent/maker-index.json");
const pm = readJson("data/parent/parent-master.json").products;

test("3-a. formOf：5 つの剤形を区別する（全角も）", () => {
  assert.equal(formOf("アムロジピン錠5mg「トーワ」"), "錠");
  assert.equal(formOf("アムロジピンOD錠5mg「トーワ」"), "OD錠");
  assert.equal(formOf("アムロジピンＯＤ錠５ｍｇ「トーワ」"), "OD錠");
  assert.equal(formOf("ランソプラゾール口腔内崩壊錠15mg"), "OD錠");
  assert.equal(formOf("セレコックスカプセル100mg"), "カプセル");
  assert.equal(formOf("モンテルカストチュアブル錠5mg「サワイ」"), "チュアブル錠");
  assert.equal(formOf("ゾルミトリプタンODフィルム2.5mg"), "ODフィルム");
  assert.equal(formOf("〇〇散10%"), "その他");
  assert.equal(formOf(null), "その他");
});

test("3-b. strengthKey：単位 mg を落とし、空白・全角・μ の書き方をそろえる", () => {
  for (const s of ["2.5mg", "2.5 mg", "２．５ｍｇ", " 2.5mg ", "2.5ｍｇ"]) assert.equal(strengthKey(s), "2.5", s);
  assert.equal(strengthKey("500μg"), "500μg");
  assert.equal(strengthKey("500µg"), "500μg"); // マイクロ記号（U+00B5）→ ギリシャ文字 μ
  assert.equal(strengthKey("500ug"), "500μg");
  assert.equal(strengthKey("500 μg"), "500μg");
  assert.notEqual(strengthKey("5mg"), strengthKey("5μg"));
  assert.equal(strengthKey(null), "");
});

test("3-c. drugKey：同じ成分・規格でも剤形が違えば別の鍵", () => {
  const g = "2171022F";
  const ks = ["錠2.5mg", "OD錠2.5mg", "カプセル2.5mg", "チュアブル錠2.5mg", "ODフィルム2.5mg"].map((n) => drugKey(g, "2.5mg", `アムロジピン${n}`));
  assert.equal(new Set(ks).size, 5);
  assert.equal(drugKey(g, "2.5 mg", "アムロジピン錠2.5mg「A」"), drugKey(g, "２．５ｍｇ", "アムロジピン錠2.5mg「B」"));
  assert.equal(drugKey(g, "2.5mg", "アムロジピンOD錠2.5mg「A」"), "2171022F|2.5|OD錠");
});

test("3-d. 実データ：同じ成分・剤形コードと規格で、素朴な鍵（剤形なし）なら混ざる口腔内崩壊錠と普通の錠が、別の薬になっている", (t) => {
  // 口腔内崩壊錠かどうかは、鍵の作り方とは別に販売名から判定する（OD錠・D錠・RM錠・RPD錠・ザイディス・口腔内崩壊）
  // 印の一覧は data/parent/form-markers.json の od から（レディタブなど、足された印も読む）
  const od = readJson("data/parent/form-markers.json").od;
  const odRe = new RegExp(od.map((w) => (/^[A-Za-z]+$/.test(w) ? `(?<![A-Za-z])${w}[\\s-]*錠` : w)).join("|"));
  const isOd = (n) => odRe.test(n.normalize("NFKC").replace(/「[^」]*」/g, ""));
  const keyOf = new Map();
  for (const [k, d] of Object.entries(index.drugs)) for (const p of d.products) keyOf.set(p.product_key, k);
  const naive = new Map();
  for (const p of pm) {
    if (p.status === "none" || formOf(p.brand_name).includes("フィルム")) continue;
    if (!/錠/.test(p.brand_name)) continue;
    const k = `${p.group}|${strengthKey(p.strength)}`;
    const g = naive.get(k) ?? { od: [], tab: [] };
    (isOd(p.brand_name) ? g.od : g.tab).push(p);
    naive.set(k, g);
  }
  const mixed = [...naive].filter(([, g]) => g.od.length && g.tab.length);
  t.diagnostic(`素朴な鍵で口腔内崩壊錠と普通の錠が混ざる組 ${mixed.length}`);
  assert.ok(mixed.length > 0);
  let checked = 0;
  for (const [k, g] of mixed) {
    const odKeys = new Set(g.od.map((p) => keyOf.get(p.product_key)));
    for (const p of g.tab) { assert.ok(!odKeys.has(keyOf.get(p.product_key)), `${k}: ${p.brand_name}`); checked++; }
    for (const p of g.od) assert.equal(keyOf.get(p.product_key), drugKey(p.group, p.strength, p.brand_name, p.yj_code), p.brand_name);
  }
  t.diagnostic(`普通の錠 ${checked} 製品が、同じ組の口腔内崩壊錠と別の薬にある`);
  const amlo = mixed.find(([k]) => k.startsWith("2171022F|2.5"));
  if (amlo) t.diagnostic(`例：${amlo[0]} 錠 ${amlo[1].tab.length} 製品／口腔内崩壊錠 ${amlo[1].od.length} 製品`);
});

// ---------- 11/10 に見つけた不具合の再発防止（11/11 に直った。今の索引で、混ざっていた例が別の薬に分かれていることを直接確かめる） ----------

/** 販売名 → 今の索引でその製品が入っている薬の鍵（同じ販売名が 1 製品だけであることも確かめる） */
function keyOfBrand(brand) {
  const hits = Object.entries(index.drugs).filter(([, d]) => d.products.some((p) => p.brand_name === brand)).map(([k]) => k);
  assert.equal(hits.length, 1, `索引で「${brand}」が 1 つの薬にだけある（${hits.join(", ")}）`);
  return hits[0];
}
const pmByBrand = new Map(pm.map((p) => [p.brand_name, p]));
/** 索引の鍵と、親マスタの値から drugKey（yj_code つき）で作り直した鍵が同じ */
const rebuilt = (brand) => { const p = pmByBrand.get(brand); return drugKey(p.group, p.strength, p.brand_name, p.yj_code); };

const OD_ALIASES = [
  ["レンドルミンD錠0.25mg", "レンドルミン錠0.25mg"],
  ["ガスターD錠10mg", "ガスター錠10mg"],
  ["アリセプトD錠5mg", "アリセプト錠5mg"],
  ["ゾーミッグRM錠2.5mg", "ゾーミッグ錠2.5mg"],
  ["マクサルトRPD錠10mg", "マクサルト錠10mg"],
  ["ジプレキサザイディス錠5mg", "ジプレキサ錠5mg"],
  ["メトリジンD錠2mg", "メトリジン錠2mg"],
];
test("3-e. D錠・RM錠・RPD錠・ザイディス錠（口腔内崩壊錠）は、普通の錠と別の薬（剤形に OD が付く）", () => {
  for (const [od, tab] of OD_ALIASES) {
    const ko = keyOfBrand(od), kt = keyOfBrand(tab);
    assert.notEqual(ko, kt, `${od} と ${tab}`);
    assert.match(ko.split("|")[2], /OD/, od);
    assert.equal(ko, rebuilt(od));
    assert.equal(kt, rebuilt(tab));
  }
});

const DDS = [
  ["アダラートCR錠20mg", "ニフェジピンL錠20mg「サワイ」"],
  ["ニフェジピンCR錠20mg「サワイ」", "ニフェジピンL錠20mg「サワイ」"],
  ["オキシコンチンTR錠10mg", "オキシコドン錠10mgNX「第一三共」"],
  ["デパケンR錠200mg", "デパケン錠200mg"],
  ["セレニカR錠200mg", "デパケンR錠200mg"],
  ["レキップCR錠2mg", "レキップ錠2mg"],
  ["ビプレッソ徐放錠50mg", "クエチアピン錠50mg「アメル」"],
  ["アザルフィジンEN錠500mg", "サラゾピリン錠500mg"],
  // YJ の 8 桁目（G・N＝徐放）だけが手がかりの製品（11/11 の相談の決定：この手がかりは残す）
  ["グラセプターカプセル1mg", "プログラフカプセル1mg"],
  ["ナルサス錠2mg", "ナルラピド錠2mg"],
  ["ユニコン錠100", "テオドール錠100mg"],
];
test("3-f. 徐放・腸溶の製剤と普通の製剤、別々の徐放製剤は別の薬（YJ の徐放の手がかりも含む）", () => {
  for (const [a, b] of DDS) {
    assert.notEqual(keyOfBrand(a), keyOfBrand(b), `${a} と ${b}`);
    assert.equal(keyOfBrand(a), rebuilt(a));
    assert.equal(keyOfBrand(b), rebuilt(b));
  }
  for (const n of ["グラセプターカプセル1mg", "ナルサス錠2mg", "ユニコン錠100"]) assert.match(keyOfBrand(n), /\|YJ徐放$/, n);
});

test("3-g. 規格「1.0mg」と「1mg」、「1.0μg」と「1μg」は同じ薬（候補に出る）。0.5 と 1 は別", () => {
  assert.equal(strengthKey("1.0mg"), strengthKey("1mg"));
  assert.equal(strengthKey("1.0μg"), strengthKey("1μg"));
  assert.equal(strengthKey("100.0mg"), "100");
  assert.equal(strengthKey("2.50mg"), "2.5");
  assert.equal(strengthKey("10mg"), "10"); // 整数の 0 は消さない
  assert.equal(strengthKey("0.25mg"), "0.25");
  assert.equal(keyOfBrand("ワイパックス錠1.0"), keyOfBrand("ロラゼパム錠1mg「サワイ」"));
  assert.equal(keyOfBrand("アルファカルシドールカプセル1.0μg「BMD」"), keyOfBrand("アルファロールカプセル1μg"));
  assert.notEqual(keyOfBrand("ワイパックス錠0.5"), keyOfBrand("ワイパックス錠1.0"));
  assert.ok(!index.drugs["1124022F|1.0|錠"] && !index.drugs["3112001F|1.0μg|カプセル"], "前の鍵が残っていない");
});

test("3-h. 見本の処方 rx-a：ニフェジピンCR錠10mg／20mg「サワイ」の「変更」には CR 錠だけが出る（L 錠・普通の錠は出ない）", async (t) => {
  const { findCandidates } = await imp("lib/makers.ts");
  const master = readJson("data/master.json");
  const bad = [];
  for (const id of ["nifedipine-cr-10-sawai", "nifedipine-cr-20-sawai"]) {
    const m = master.find((x) => x.id === id);
    const c = findCandidates(index, m.drug_key, m.product_key);
    const notCr = c.filter((x) => !/CR錠/.test(x.brand_name.normalize("NFKC")));
    t.diagnostic(`${m.brand_name}：候補 ${c.length}、CR 錠でないもの ${notCr.length}`);
    assert.ok(c.length > 0, id);
    bad.push(...notCr.map((x) => `${id} → ${x.brand_name}`));
  }
  assert.deepEqual(bad, []);
});
