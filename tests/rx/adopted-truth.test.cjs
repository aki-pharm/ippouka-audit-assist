// 段階 2 の正解（data/rx-testset/expected-adopted.csv）を、施設のマスタ（facility.json）と処方から品質が独立に決め直して比べる。
// 作業側の決め方（scripts/make-rx-facility.cjs の表・YJ コード・一般名）は使わない。名前と、品質が書いた先発→一般名の対応表だけで決める。
//
// 決まり（コーディネーターから）
// - 成分・規格・剤形が同じものだけが同じ薬。OD とふつうの錠、放出（CR・L など）は別の薬
// - 先発名の処方 → 同じ成分・規格・剤形の採用中の後発品（先発品そのものが採用中ならそれ）
// - 採用中止（adopted:false）は採用なし。今のメーカーが決まっていない（maker_state 未選択・両方）は「メーカー未確定」
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DATA, defs, parseCsv } = require("./helpers.cjs");

const facility = JSON.parse(fs.readFileSync(path.join(DATA, "facility.json"), "utf8")).products;
const [h, ...rest] = parseCsv(fs.readFileSync(path.join(DATA, "expected-adopted.csv"), "utf8")).filter((r) => r.length > 1);
const truth = rest.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]])));

// 先発名・商品名 → 一般的な名前（成分・剤形・規格）。品質が添付文書の知識で書いた
const BRAND = {
  "ノルバスク錠5mg": "アムロジピン錠5mg",
  "リピトール錠10mg": "アトルバスタチン錠10mg",
  "パリエット錠10mg": "ラベプラゾールna錠10mg",
  "ムコスタ錠100mg": "レバミピド錠100mg",
  "マグミット錠330mg": "酸化マグネシウム錠330mg",
  "ガスモチン錠5mg": "モサプリドクエン酸塩錠5mg",
  "メトグルコ錠500mg": "メトホルミン塩酸塩錠500mgmt",
  "アーチスト錠10mg": "カルベジロール錠10mg",
  "ラシックス錠20mg": "フロセミド錠20mg",
  "アルダクトンa錠25mg": "スピロノラクトン錠25mg",
  "メチコバール錠500μg": "メコバラミン錠500μg",
  "メチコバール錠250μg": "メコバラミン錠250μg",
  "エディロールカプセル0.75μg": "エルデカルシトールカプセル0.75μg",
  "ワーファリン錠1mg": "ワルファリンカリウム錠1mg",
  "ワーファリン錠0.5mg": "ワルファリンカリウム錠0.5mg",
  "フォリアミン錠5mg": "葉酸錠5mg",
  "リボトリール錠0.5mg": "クロナゼパム錠0.5mg",
  "ジゴシン錠0.125mg": "ジゴキシン錠0.125mg",
  "リオナ錠250mg": "クエン酸第二鉄錠250mg",
  "アスパラカリウム錠300mg": "l-アスパラギン酸カリウム錠300mg",
  "アスパラ-ca錠200mg": "l-アスパラギン酸カルシウム錠200mg",
};
// 一般名処方の剤形の書き方 → 製品名の書き方（【般】の行）
function generalForm(name, note) {
  let n = name.replace(/腸溶性口腔内崩壊錠|口腔内崩壊錠/, "od錠");
  if (/徐放錠/.test(n)) n = n.replace("徐放錠", note === "24時間持続" ? "cr錠" : note === "12時間持続" ? "l錠" : "徐放錠");
  return n;
}
const nf = (s) => String(s).normalize("NFKC").replace(/[\s　]/g, "").replace(/[µμ]/g, "μ").toLowerCase();
/** 成分・剤形・規格の鍵：メーカー「」・接頭辞・【般】を除き、先発名は一般的な名前に */
function key(name, note) {
  let n = nf(name).replace(/[「『][^」』]*[」』]/g, "").replace(/^\((k|ca|na)\)/, "");
  if (n.startsWith("【般】")) n = generalForm(n.slice(3), note);
  return BRAND[n] ?? n;
}
const unknownMaker = (p) => !!p.maker_state && (p.maker_state === "未選択" || p.maker_state.includes("両方"));

/** 処方の 1 行 → 正解（採用品の id／採用なし／メーカー未確定 [id]／判断できない） */
function decide(r) {
  const exact = facility.find((p) => p.brand_name === r.name.replace(/^\((K|Ca|Na)\)/, "") && p.adopted);
  const k = key(r.name, r.note);
  const same = facility.filter((p) => p.adopted && key(p.brand_name) === k);
  const pick = exact ?? (same.length === 1 ? same[0] : null);
  if (!pick) return same.length > 1 ? { expected: "判断できない", why: same.map((p) => p.id).join(" / ") } : { expected: "採用なし" };
  return unknownMaker(pick) ? { expected: "メーカー未確定", pending: pick.id } : { expected: pick.id };
}

test("段階 2 の正解 145 行：品質が決め直したものと一致（食い違いは一覧で出す）", () => {
  const rows = defs().flatMap((d) => d.pages.flat().map((r, i) => ({ rx: d.id, rp: String(i + 1).padStart(2, "0"), ...r })));
  assert.equal(rows.length, 145);
  assert.equal(truth.length, 145);
  const diffs = [];
  for (const r of rows) {
    const t = truth.find((x) => x.rx === r.rx && x.rp === r.rp);
    const mine = decide(r);
    const same = t && t.expected === mine.expected && (mine.expected !== "メーカー未確定" || t.pending_product === mine.pending);
    if (!same) diffs.push(`${r.rx} Rp${r.rp} ${r.name}：作業 ${t?.expected}${t?.pending_product ? `（${t.pending_product}）` : ""} ／ 品質 ${mine.expected}${mine.pending ? `（${mine.pending}）` : ""}${mine.why ? `［${mine.why}］` : ""}`);
  }
  assert.deepEqual(diffs, []);
});

test("施設のマスタ：id は重複なし、正解の id はすべて採用中、採用中止は 2・未確定は 2・別名は 4（docs のとおり）", () => {
  const ids = facility.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(facility.length, 90);
  for (const t of truth) {
    if (t.expected === "採用なし") continue;
    const id = t.expected === "メーカー未確定" ? t.pending_product : t.expected;
    const p = facility.find((x) => x.id === id);
    assert.ok(p, `${t.rx} Rp${t.rp}: ${id} が無い`);
    assert.equal(p.adopted, true, `${t.rx} Rp${t.rp}: ${id} は採用中止`);
  }
  assert.equal(facility.filter((p) => !p.adopted).length, 2);
  assert.equal(facility.filter(unknownMaker).length, 2);
  assert.equal(facility.filter((p) => p.aliases?.length).length, 4);
  // 架空の施設：施設名などの項目を持たない
  const keys = new Set(facility.flatMap((p) => Object.keys(p)));
  for (const k of keys) assert.doesNotMatch(k, /facility|hospital|施設|病院/);
});
