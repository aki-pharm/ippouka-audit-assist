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

test("3-d. 実データ：同じ成分・剤形コードと規格で、素朴な鍵（剤形なし）なら混ざる OD 錠と普通の錠が、別の薬になっている", (t) => {
  const naive = new Map();
  for (const p of pm) {
    if (p.status === "none") continue;
    const k = `${p.group}|${strengthKey(p.strength)}`;
    const forms = naive.get(k) ?? new Map();
    const f = formOf(p.brand_name);
    forms.set(f, [...(forms.get(f) ?? []), p.product_key]);
    naive.set(k, forms);
  }
  const mixed = [...naive].filter(([, forms]) => forms.has("OD錠") && forms.has("錠"));
  t.diagnostic(`素朴な鍵で OD 錠と錠が混ざる組 ${mixed.length}`);
  assert.ok(mixed.length > 0);
  for (const [k, forms] of mixed) {
    const od = index.drugs[`${k}|OD錠`], tab = index.drugs[`${k}|錠`];
    assert.ok(od && tab, k);
    for (const pk of forms.get("OD錠")) assert.ok(od.products.some((p) => p.product_key === pk) && !tab.products.some((p) => p.product_key === pk), pk);
  }
  // 代表例（実データ）。アムロジピン 2.5mg の錠と OD 錠
  const amlo = mixed.find(([k]) => k.startsWith("2171022F|2.5"));
  if (amlo) t.diagnostic(`例：${amlo[0]} 錠 ${amlo[1].get("錠").length} 製品／OD錠 ${amlo[1].get("OD錠").length} 製品`);
});

// ---------- 見つけた不具合（todo：失敗しても npm の結果は落とさない。直したら todo を外す） ----------

// 「D錠」「RM錠」「RPD錠」「ザイディス錠」は口腔内崩壊錠だが、販売名に「OD錠」「口腔内崩壊」を含まないので「錠」に入る
const OD_ALIASES = [
  ["1124009F", "0.25mg", "レンドルミンD錠0.25mg", "レンドルミン錠0.25mg"],
  ["2325003F", "10mg", "ガスターD錠10mg", "ガスター錠10mg"],
  ["1190012F", "5mg", "アリセプトD錠5mg", "アリセプト錠5mg"],
  ["2160004F", "2.5mg", "ゾーミッグRM錠2.5mg", "ゾーミッグ錠2.5mg"],
  ["2160006F", "10mg", "マクサルトRPD錠10mg", "マクサルト錠10mg"],
  ["1179044F", "5mg", "ジプレキサザイディス錠5mg", "ジプレキサ錠5mg"],
];
test("【不具合】3-e. D錠・RM錠・RPD錠・ザイディス錠（口腔内崩壊錠）が普通の錠と同じ薬になる", { todo: "drugKey/formOf が口腔内崩壊錠の別名を知らない" }, () => {
  for (const [g, s, od, tab] of OD_ALIASES) {
    const k = drugKey(g, s, tab);
    assert.ok(index.drugs[k]?.products.some((p) => p.brand_name === od), `前提：索引で ${od} が ${k} に入っている`);
    assert.notEqual(drugKey(g, s, od), k, `${od} と ${tab}`);
  }
});

// 徐放錠（CR・L・R・SR・TR・徐放）と普通の錠、また別々の徐放製剤が同じ薬になる。代わりに選べてしまう
const DDS = [
  ["2171014F", "20mg", "アダラートCR錠20mg", "ニフェジピンL錠20mg「サワイ」"],
  ["8119002F", "10mg", "オキシコンチンTR錠10mg", "オキシコドン錠10mgNX「第一三共」"],
  ["1139004F", "200mg", "デパケンR錠200mg", "デパケン錠200mg"],
  ["1139004F", "200mg", "セレニカR錠200mg", "デパケンR錠200mg"],
  ["1169013F", "2mg", "レキップCR錠2mg", "レキップ錠2mg"],
  ["1179042F", "50mg", "ビプレッソ徐放錠50mg", "クエチアピン錠50mg「アメル」"],
];
test("【不具合】3-f. 徐放錠と普通の錠（ニフェジピン CR と L、オキシコンチン TR と速放錠など）が同じ薬になる", { todo: "drugKey が徐放・腸溶など放出の違いを見ていない（YJ の上 8 桁が同じ）" }, () => {
  for (const [g, s, a, b] of DDS) {
    const k = drugKey(g, s, b);
    assert.ok(index.drugs[k]?.products.some((p) => p.brand_name === a), `前提：索引で ${a} が ${k} に入っている`);
    assert.notEqual(drugKey(g, s, a), k, `${a} と ${b}`);
  }
});

test("【不具合】3-g. 規格「1.0mg」と「1mg」、「1.0μg」と「1μg」が別の薬に分かれる（候補に出ない）", { todo: "strengthKey が数値の末尾の 0 をそろえない" }, () => {
  assert.ok(index.drugs["1124022F|1.0|錠"] && index.drugs["1124022F|1|錠"], "前提：索引に両方ある");
  assert.equal(strengthKey("1.0mg"), strengthKey("1mg"));
  assert.equal(strengthKey("1.0μg"), strengthKey("1μg"));
  assert.equal(drugKey("1124022F", "1.0mg", "ワイパックス錠1.0"), drugKey("1124022F", "1mg", "ロラゼパム錠1mg「サワイ」"));
});

test("【不具合】3-h. 見本の処方 rx-a：ニフェジピンCR錠10mg／20mg「サワイ」の「変更」に、L 錠（1 日 2 回の製剤）と普通の錠が候補として出る", async (t) => {
  const { findCandidates } = await imp("lib/makers.ts");
  const master = readJson("data/master.json");
  const bad = [];
  for (const id of ["nifedipine-cr-10-sawai", "nifedipine-cr-20-sawai"]) {
    const m = master.find((x) => x.id === id);
    const c = findCandidates(index, m.drug_key, m.product_key);
    const notCr = c.filter((x) => !/CR錠/.test(x.brand_name.normalize("NFKC")));
    t.diagnostic(`${m.brand_name}：候補 ${c.length}、CR 錠でないもの ${notCr.length}（${notCr.map((x) => x.brand_name).join("、")}）`);
    bad.push(...notCr.map((x) => `${id} → ${x.brand_name}`));
  }
  assert.deepEqual(bad, []);
});
