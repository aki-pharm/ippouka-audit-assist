/**
 * メーカー選択の索引を作る（親マスタから、成分・規格・剤形ごとに製品をまとめる）。
 *   node scripts/build-maker-index.cjs                 … data/parent/maker-index.json を作る
 *   node scripts/build-maker-index.cjs --link-master   … あわせて data/master.json の各行に product_key・drug_key・maker_state を入れる
 * 入力：data/parent/parent-master.json、data/parent/naifuku-tablets-*.csv（成分名）
 * 出力：data/parent/maker-index.json（画面の「変更」で出す候補。サーバ側の /api/makers が読む）
 *
 * 薬の鍵（drug_key）は「成分・剤形コード|規格|剤形」（YJ が徐放・腸溶を示し販売名に印が無いときは「|YJ徐放」などを足す）。
 * 剤形は販売名の放出の印（CR・L・R・SR・TR・徐放・腸溶・OD など、data/parent/form-markers.json）ごとに分ける。迷ったら分ける。
 * lib/makers.ts の drugKey()・scripts/ops/build-ops-master.py と同じ決め方。作るたびに lib/makers.ts と全製品の鍵が同じかを確かめる
 * 親マスタは全医薬品の公開データなので、索引も全部の薬を入れる。施設の採用品（data/private/）で絞らない
 * （絞って commit すると、どの施設が何を採用しているかが見えてしまうため）。
 */
const fs = require("fs");
const path = require("path");

const norm = (s) => (s || "").normalize("NFKC").replace(/[\s・･®（）()「」]/g, "").toLowerCase();
// 剤形・放出の印は data/parent/form-markers.json に 1 つだけ置き、lib/makers.ts・scripts/ops/build-ops-master.py と共有する
const MARKERS = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/parent/form-markers.json"), "utf8"));
const isLatin = (w) => /^[A-Za-z]+$/.test(w);
/**
 * 販売名から剤形（放出の印つき）を決める。lib/makers.ts の formOf と同じ手順（変えるときは 3 か所とも）
 *  1. NFKC、「」の中（メーカー）を除く。（）の中は印を探す本体からは除く（ただし「徐放・持続・腸溶」はどこにあっても印にする）
 *  2. 土台：ODフィルム ＞ 最初に出る「錠」か「カプセル」。どちらも無ければ「その他」
 *  3. 土台の直前の印を後ろから読む（区切りの記号は飛ばす）。英字の印（CR・L・OD など）、日本語の印（徐放・口腔内崩壊など）。
 *     数字の直後の英字（1mg錠 の mg）と塩（Na・K・Ca）は印にしない。一覧に無い英字は、土台のすぐ前のときだけ印にする（迷ったら分ける）
 *  4. 口腔内崩壊の別名（OD・D・RM・RPD・ザイディス）は「OD」に、EN は「腸溶」にそろえる
 *  5. 土台の直後の英字（徐放錠A の A、配合錠LD の LD）と、規格の直後の英字（0.375mgMI の MI）も剤形に足す
 */
function parseForm(name) {
  const M = MARKERS;
  const full = (name || "").normalize("NFKC").replace(/「[^」]*」/g, "");
  const m = full.replace(/[（(][^）)]*[）)]/g, "");
  let base, idx;
  const film = m.indexOf("ODフィルム");
  if (film >= 0) [idx, base] = [film, "ODフィルム"];
  else {
    const hits = [[m.indexOf("カプセル"), "カプセル"], [m.indexOf("錠"), "錠"]].filter(([i]) => i >= 0).sort((a, b) => a[0] - b[0]);
    if (!hits.length) return { label: "その他", release: false };
    [idx, base] = hits[0];
  }
  const all = [...M.od, ...M.release, ...M.other];
  const latin = new Set(all.filter(isLatin));
  const words = all.filter((w) => !isLatin(w)).sort((a, b) => b.length - a.length);
  const tokens = [];
  let pre = m.slice(0, idx);
  if (base !== "ODフィルム") {
    for (;;) {
      while (pre && M.separators.includes(pre.at(-1))) pre = pre.slice(0, -1);
      const lm = pre.match(/[A-Za-z]+$/);
      if (lm) {
        const w = lm[0], before = pre.slice(0, -w.length);
        if (/\d$/.test(before) || M.salt.includes(w) || (!latin.has(w) && tokens.length)) break;
        tokens.push(w);
        pre = before;
        continue;
      }
      const jw = words.find((w) => pre.endsWith(w));
      if (!jw) break;
      tokens.push(jw);
      pre = pre.slice(0, -jw.length);
    }
  }
  const label = tokens.reverse().map((t) => (M.od.includes(t) ? "OD" : M.rename[t] ?? t));
  for (const w of [...M.anywhere].reverse()) if (full.includes(w) && !label.includes(w)) label.unshift(w);
  const rest = m.slice(idx + base.length);
  const s1 = rest.match(/^[A-Za-z]+/)?.[0] ?? "";
  const s2 = (rest.match(/\d([A-Za-zμ]+)\s*$/)?.[1] ?? "").replace(/^(mg|μg|ug|mcg|g)/, "");
  const release = label.some((t) => M.release.includes(t));
  // 放出の印があるときは、印の前の名前（デパケン／セレニカ、アダラート／ニフェジピン）も剤形に入れる。
  // 同じ「R錠」でも製品の系列が違えば放出の仕方が同じとは言えないため（迷ったら分ける）
  const stem = release ? pre.replace(/[\s・･\-‐‑‒–—−]/g, "") : "";
  return { label: label.join("") + base + s1 + (stem ? `〔${stem}〕` : "") + (s2 ? "/" + s2 : ""), release };
}
const formOf = (name) => parseForm(name).label;
/**
 * YJ コードの 8 桁目（剤形）を、もう 1 つの分ける手がかりにする。G・N（徐放）、H（腸溶）のときだけ。
 * 販売名に放出の印が無いのに YJ が徐放・腸溶を示す製品（ユニコン錠、グラセプターカプセル、ナルサス錠など）を、
 * 普通の製剤から分けるため。YJ が無い・上 7 桁が成分・剤形コードと違う製品は手がかりなし
 */
function yjSegment(group, name, yjCode) {
  const y = yjCode || "";
  if (y.length < 8 || y.slice(0, 7) !== (group || "").slice(0, 7) || !MARKERS.yj[y[7]]) return "";
  return parseForm(name).release ? "" : `YJ${MARKERS.yj[y[7]]}`;
}

// 規格：単位 mg を落とし、小数の末尾の 0 をそろえる（1.0mg と 1mg を同じに）
const strengthKey = (s) => norm(s).replace(/(\d+)\.(\d*?)0+(?!\d)/g, (_, a, b) => (b ? `${a}.${b}` : a)).replace("mg", "").replace("ug", "μg");
/** 薬の鍵「成分・剤形コード|規格|剤形」。YJ が徐放・腸溶を示し販売名に印が無いときだけ「|YJ徐放」などを足す */
const drugKey = (group, strength, brand, yjCode) => {
  const seg = yjSegment(group, brand, yjCode);
  return `${group}|${strengthKey(strength)}|${formOf(brand)}` + (seg ? `|${seg}` : "");
};
const stem = (name) => {
  let n = (name || "").normalize("NFKC").replace(/「.*?」|\(.*?\)|（.*?）/g, "");
  n = n.split(/OD錠|錠|カプセル|配合錠|チュアブル|ODフィルム/)[0];
  return n.replace(/\d+(\.\d+)?\s*(mg|μg|ug|g|単位)?$/, "").trim();
};
// 名前の照合（含量の書き方だけ違う「フォリアミン錠5mg」と「フォリアミン錠」を同じにする緩いキー。規格の一致も見る）
const nameKey = (s) => (s || "").normalize("NFKC").replace(/[\s　®]/g, "").replace(/[（(][^）)]*[）)]/g, "").replace(/[‐‑‒–—−]/g, "-").toLowerCase();
const loose = (s) => nameKey(s).replace(/\d+(\.\d+)?(mg|μg|mcg|g)?$/, "");

const readCsv = (f) => {
  const text = fs.readFileSync(f, "utf8").replace(/^﻿/, "");
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (ch !== "\r") cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const [h, ...b] = rows;
  return b.filter((r) => r.length > 1).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ""])));
};

module.exports = { formOf, parseForm, strengthKey, drugKey, MARKERS };
if (require.main === module) main();

function main() {
checkSameAsMakersTs();
const pm = JSON.parse(fs.readFileSync("data/parent/parent-master.json", "utf8")).products;
const genericByYj = {};
for (const f of fs.readdirSync("data/parent").sort()) {
  if (f.startsWith("naifuku-tablets-") && f.endsWith(".csv"))
    for (const r of readCsv(path.join("data/parent", f))) genericByYj[r.yj_code] = r.generic_name;
}

const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0)));
const STATUS_ORDER = { verified: 0, confirmed: 1, draft: 2 };
// 親マスタにある、製品でない行（PMDA の一覧に載る患者向け・医療従事者向けの資材）。索引にも照合にも入れない
const NOT_PRODUCT = /患者さん|患者向け|ご家族|医療従事者向け|資材|にあたって|による治療を受け|を服用される/;
const notProduct = [];
const drugs = {};
let nProducts = 0;
for (const p of pm) {
  if (p.status === "none") continue; // 外観の下書きがない製品（組み合わせ品など）は候補にしない
  if (NOT_PRODUCT.test(p.brand_name.normalize("NFKC"))) { notProduct.push(p.brand_name); continue; } // 患者向け資材など、製品でない行
  const key = drugKey(p.group, p.strength, p.brand_name, p.yj_code);
  const d = (drugs[key] ??= { generic_name: "", strength: p.strength, form: formOf(p.brand_name), products: [] });
  if (!d.generic_name && genericByYj[p.yj_code]) d.generic_name = genericByYj[p.yj_code];
  // 空の欄（null・空文字・空配列）は書かない（索引を小さくするため）。読む側（lib/makers.ts）で null として扱う
  d.products.push(compact({
    product_key: p.product_key,
    brand_name: p.brand_name,
    maker: p.maker || "",
    imprint_front: p.imprint_front,
    imprint_back: p.imprint_back,
    imprint_note: p.imprint_note || null,
    color: p.color,
    color_hex: p.color_hex || null,
    shape: p.shape || null,
    size_long_mm: p.size_long_mm ?? null,
    size_short_mm: p.size_short_mm ?? null,
    thickness_mm: p.thickness_mm ?? null,
    score_line: p.score_line ?? null,
    status: p.status,
    source_url: p.source_url || null,
    source_revision: p.source_revision || null,
    verified_by: p.verified_by || null,
    verified_at: p.verified_at || null,
    flags: p.flags || [],
  }));
  nProducts++;
}
for (const d of Object.values(drugs)) {
  if (!d.generic_name) d.generic_name = stem(d.products[0].brand_name);
  d.products.sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || a.brand_name.localeCompare(b.brand_name, "ja"));
}
const sorted = Object.fromEntries(Object.keys(drugs).sort().map((k) => [k, drugs[k]]));
const out = { built_at: new Date().toISOString(), source: "data/parent/parent-master.json", drug_count: Object.keys(sorted).length, product_count: nProducts, drugs: sorted };
fs.writeFileSync("data/parent/maker-index.json", JSON.stringify(out) + "\n");
const multi = Object.values(sorted).filter((d) => d.products.length > 1).length;
if (notProduct.length) console.log(`製品でない行を除いた ${notProduct.length}：${notProduct.join("、")}`);
console.log(`maker-index.json：薬 ${out.drug_count}（うち候補が 2 つ以上 ${multi}）、製品 ${nProducts}、${(fs.statSync("data/parent/maker-index.json").size / 1e6).toFixed(2)} MB`);

// ---------- 処方箋の名前 → 薬の鍵（lib/match-data.ts。照合 lib/matching.ts が画面の中で使う） ----------
// 親マスタの全製品の販売名・鍵・先発／後発と、成分・剤形コードごとの一般名。施設の採用品は入れない（公開データだけ）
{
  const naifuku = {};
  for (const f of fs.readdirSync("data/parent").sort())
    if (f.startsWith("naifuku-tablets-") && f.endsWith(".csv")) for (const r of readCsv(path.join("data/parent", f))) naifuku[r.yj_code] = r;
  const keys = Object.keys(sorted);
  const keyIdx = new Map(keys.map((k, i) => [k, i]));
  const nk = (s) => (s || "").normalize("NFKC").replace(/[\s　®]/g, "").toLowerCase();
  // 先発・後発：1＝先発、2＝後発、3＝どちらでもない（厚労省の一覧の印が両方 False）、0＝不明（照合では自動で選ばない）
  // 製品ごとの情報を、統一名（メーカーの無い行。後発品をまとめた行）より先に使う
  //  1. 一覧に同じ販売名の行がある → その行の印（「」つきの先発品もある：アロチノロール塩酸塩錠「DSP」）。ただし印が両方 False で「」つきなら後発
  //  2. 販売名に「」がある → 後発（一覧に名前が無く YJ が統一名を指すものも。後発品の名づけの決まり）
  //  3. 一覧で同じ成分（YJ 上 7 桁）の先発品の製造販売元と、製品のメーカーが同じ → 先発（パキシル、クレストール など）
  //  4. それ以外（YJ が統一名を指すが「」の無い製品＝先発か、販売名つきの後発か分からない、など）→ 不明
  const byName = new Map();
  const originalMakers = new Map(); // YJ 上 7 桁 → 先発品の製造販売元
  for (const r of Object.values(naifuku)) {
    byName.set(nk(r.brand_name), r);
    if (r.is_original === "True" && r.maker) originalMakers.set(r.yj_code.slice(0, 7), [...(originalMakers.get(r.yj_code.slice(0, 7)) ?? []), r.maker]);
  }
  const makerKey = (s) => nk(s).replace(/^製造販売元[／/]?/, "").replace(/株式会社|合同会社|有限会社|\(株\)|㈱/g, "");
  const familyOf = (name) => (name || "").normalize("NFKC").replace(/「[^」]*」/g, "").split(/配合|OD錠|錠|カプセル|\d/)[0];
  // 一覧の販売名の行を、親マスタのメーカー名＋系列でまとめる（親マスタの製品のメーカー名で引くため）
  const siblings = new Map();
  for (const q of pm) {
    const r = byName.get(nk(q.brand_name));
    if (!r || /「[^」]+」/.test(q.brand_name.normalize("NFKC"))) continue;
    const k = `${makerKey(q.maker)}|${familyOf(q.brand_name)}`;
    siblings.set(k, [...(siblings.get(k) ?? []), r]);
  }
  const cover = { "一覧の同じ販売名": 0, "販売名の「」（後発）": 0, "同じメーカーの同じ系列の販売名": 0, "先発品と同じ製造販売元（先発）": 0, "不明": 0 };
  const originOf = (p) => {
    const flag = (r) => (r.is_original === "True" ? 1 : r.is_generic === "True" ? 2 : 3);
    const quoted = /「[^」]+」/.test((p.brand_name || "").normalize("NFKC"));
    const r = byName.get(nk(p.brand_name));
    // 一覧に同じ販売名の行があればその印（アロチノロール塩酸塩錠「DSP」のような「」つきの先発品も）。両方 False で「」つきなら後発
    if (r && !(quoted && flag(r) === 3)) { cover["一覧の同じ販売名"]++; return flag(r); }
    if (quoted) { cover["販売名の「」（後発）"]++; return 2; }
    // 同じメーカーの同じ系列の販売名（エヌケーエスワン配合OD錠T25 → T20）が一覧にあり、印がそろっていればその印
    const fam = familyOf(p.brand_name);
    const sib = fam.length >= 3 ? (siblings.get(`${makerKey(p.maker)}|${fam}`) ?? []) : [];
    if (sib.length && new Set(sib.map(flag)).size === 1 && makerKey(p.maker).length >= 2) { cover["同じメーカーの同じ系列の販売名"]++; return flag(sib[0]); }
    const mk = makerKey(p.maker);
    const om = p.yj_code ? originalMakers.get(p.yj_code.slice(0, 7)) ?? [] : [];
    if (mk.length >= 2 && om.some((m) => { const k = makerKey(m); return k.length >= 2 && (mk.includes(k) || k.includes(mk)); })) { cover["先発品と同じ製造販売元（先発）"]++; return 1; }
    cover["不明"]++;
    return 0;
  };
  // 親マスタの YJ が統一名の行（メーカーの無い行）を指すとき、その行の剤形・規格が製品と合わないことがある
  // （ブロチゾラム錠0.25mg「サワイ」が「ブロチゾラム0.25mg口腔内崩壊錠」の YJ を持つ）。同じ成分の統一名の行から、
  // 剤形（放出の印と土台）と規格が製品と同じ行を 1 つに決められればその YJ を使う。決められなければ YJ は使わない（""）
  const unified = Object.values(naifuku).filter((r) => !r.maker);
  // 統一名の行の名前（「…徐放錠」「…腸溶錠」「…口腔内崩壊錠」）と製品の名前（SR・CR・EN・D など）は印の書き方が違うので、粗く比べる
  const relType = (name) => {
    const { label, release } = parseForm(name);
    const base = label.includes("カプセル") ? "カプセル" : label.includes("錠") ? "錠" : label;
    const other = ["チュアブル", "舌下", "分散", "粒状", "発泡", "バッカル"].find((w) => label.includes(w)) ?? "";
    return (/^[^〔]*OD/.test(label) ? "OD" : "") + (/腸溶/.test(label) ? "腸溶" : release ? "徐放" : "") + other + base;
  };
  const yjFix = { "製品の行": 0, "統一名の行が合う": 0, "統一名の行を選び直した": 0, "決められない": 0 };
  const yj9Of = (p) => {
    if (!p.yj_code || p.yj_code.length < 9 || p.yj_code.slice(0, 7) !== p.group.slice(0, 7)) return "";
    const own = naifuku[p.yj_code];
    if (!own || own.maker) { yjFix["製品の行"]++; return p.yj_code.slice(0, 9); }
    const ok = (r) => relType(r.brand_name) === relType(p.brand_name) && strengthKey(r.strength.replace(/1(錠|カプセル)$/, "")) === strengthKey(p.strength);
    if (ok(own)) { yjFix["統一名の行が合う"]++; return p.yj_code.slice(0, 9); }
    const alt = unified.filter((r) => r.yj_code.slice(0, 7) === p.yj_code.slice(0, 7) && ok(r));
    if (new Set(alt.map((r) => r.yj_code.slice(0, 9))).size === 1) { yjFix["統一名の行を選び直した"]++; return alt[0].yj_code.slice(0, 9); }
    yjFix["決められない"]++;
    return "";
  };
  const products = [];
  const generics = {};
  for (const p of pm) {
    if (p.status === "none" || NOT_PRODUCT.test(p.brand_name.normalize("NFKC"))) continue;
    const yj = p.yj_code && p.yj_code.length >= 8 && p.yj_code.slice(0, 7) === p.group.slice(0, 7) ? p.yj_code[7] : "";
    // YJ の上 9 桁（成分・剤形・規格）。別の製品を自動で選ぶときの必要条件（lib/matching.ts）。統一名の行の取り違えを直したもの
    const yj9 = yj9Of(p);
    products.push([p.brand_name, keyIdx.get(drugKey(p.group, p.strength, p.brand_name, p.yj_code)), originOf(p), yj, yj9]);
    if (!generics[p.group] && naifuku[p.yj_code]?.generic_name && naifuku[p.yj_code].yj_code.slice(0, 7) === p.group.slice(0, 7)) generics[p.group] = naifuku[p.yj_code].generic_name;
  }
  for (const k of keys) { const g = k.split("|")[0]; if (!generics[g]) generics[g] = sorted[k].generic_name; }
  // YJ の無い製品（厚労省の一覧に無い後発品など）：メーカーを除いた販売名と鍵が同じ製品の YJ の上 9 桁が 1 つにそろっていれば、それを使う
  // （ニフェジピンL錠10mg「トーワ」← 「サワイ」「日医工」の 2171014G1）。そろわなければ YJ なしのまま（照合では候補にとどめる）
  {
    const mless = (n) => nk(n.normalize("NFKC").replace(/「[^」]*」/g, "").replace(/[（(][^）)]*[）)]/g, ""));
    const fam = new Map();
    for (const x of products) if (x[4]) { const k = `${mless(x[0])}|${x[1]}`; fam.set(k, new Set([...(fam.get(k) ?? []), x[4]])); }
    for (const x of products) {
      if (x[4]) continue;
      const s9 = fam.get(`${mless(x[0])}|${x[1]}`);
      if (s9 && s9.size === 1) { x[4] = [...s9][0]; yjFix["同じ名前の製品から"] = (yjFix["同じ名前の製品から"] ?? 0) + 1; }
      else yjFix["YJ なし"] = (yjFix["YJ なし"] ?? 0) + 1;
    }
  }
  const prof = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/match-profiles.json"), "utf8"));
  const exceptions = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/match-exceptions.json"), "utf8")).pairs;
  const data = { keys, products, generics: Object.fromEntries(Object.keys(generics).sort().map((g) => [g, generics[g]])), profiles: prof.profiles, default_profile: prof.default, general_release_notes: prof.general_release_notes, exceptions };
  const ts = `// 自動生成（node scripts/build-maker-index.cjs）。手で直さない。元：data/parent/parent-master.json、data/parent/naifuku-tablets-*.csv、data/match-profiles.json、data/match-exceptions.json
// products は [販売名, keys の番号, 先発・後発（1 先発／2 後発／3 どちらでもない／0 不明）, YJ の 8 桁目, YJ の上 9 桁（どちらも上 7 桁が成分・剤形コードと同じときだけ）]
import type { MatchData } from "./matching.ts";

export const MATCH_DATA: MatchData = ${JSON.stringify(data)};
`;
  fs.mkdirSync("lib", { recursive: true });
  fs.writeFileSync("lib/match-data.ts", ts);
  const dist = [0, 1, 2, 3].map((o) => products.filter((x) => x[2] === o).length);
  console.log("YJ の上 9 桁の出どころ：" + Object.entries(yjFix).map(([k, v]) => `${k} ${v}`).join("、"));
  console.log(`先発・後発の分布：先発 ${dist[1]}／後発 ${dist[2]}／どちらでもない ${dist[3]}／不明 ${dist[0]}`);
  console.log(`lib/match-data.ts：販売名 ${products.length}、一般名 ${Object.keys(data.generics).length}、${(Buffer.byteLength(ts) / 1e6).toFixed(2)} MB。先発・後発の出どころ：` + Object.entries(cover).map(([k, v]) => `${k} ${v}`).join("、"));
}

// ---------- --link-master：data/master.json の各行を親マスタの製品につなぐ ----------
if (process.argv.includes("--link-master")) {
  const master = JSON.parse(fs.readFileSync("data/master.json", "utf8"));
  const byName = new Map(pm.map((p) => [nameKey(p.brand_name), p]));
  const byLoose = new Map();
  for (const p of pm) byLoose.set(loose(p.brand_name), [...(byLoose.get(loose(p.brand_name)) ?? []), p]);
  let linked = 0;
  const next = master.map((t) => {
    const names = [t.brand_name, ...(t.aliases ?? [])];
    let p = names.map((n) => byName.get(nameKey(n))).find(Boolean);
    if (!p) {
      const hits = names.flatMap((n) => byLoose.get(loose(n)) ?? []).filter((x) => strengthKey(x.strength) === strengthKey(t.strength));
      if (new Set(hits.map((x) => x.product_key)).size === 1) p = hits[0];
    }
    if (p) linked++;
    else console.log(`  親マスタにつながらない：${t.id} ${t.brand_name}`);
    // 既存の値はそのまま。maker の後ろに 3 つの欄を足す（product_key・maker_state はすでにあれば上書きしない）
    const o = {};
    for (const [k, v] of Object.entries(t)) {
      if (k === "product_key" || k === "drug_key" || k === "maker_state") continue;
      o[k] = v;
      if (k === "maker") {
        o.product_key = t.product_key ?? p?.product_key ?? null;
        o.drug_key = p ? drugKey(p.group, p.strength, p.brand_name, p.yj_code) : (t.drug_key ?? null); // 鍵の決め方が変わっても作り直せるように、毎回親マスタから作る
        // デモ施設の 28 品目は、実物の写真で確認した製品をそのまま「今のメーカー」とする
        o.maker_state = t.maker_state ?? (t.status === "verified" ? "確認ずみ（現物）" : "未選択");
      }
    }
    return o;
  });
  fs.writeFileSync("data/master.json", JSON.stringify(next, null, 2) + "\n");
  console.log(`data/master.json：${linked}/${master.length} 品目を親マスタの製品につないだ`);
}
}

/** lib/makers.ts の印の写しと鍵の作り方が、このスクリプトと同じかを確かめる（違えば止まる。3 か所がずれないように） */
function checkSameAsMakersTs() {
  const tsPath = path.join(__dirname, "../lib/makers.ts");
  const src = fs.readFileSync(tsPath, "utf8");
  const lit = src.match(/\/\*FORM_MARKERS_BEGIN\*\/([\s\S]*?)\/\*FORM_MARKERS_END\*\//)?.[1];
  const { note, ...want } = MARKERS;
  if (!lit || JSON.stringify(JSON.parse(lit)) !== JSON.stringify(want)) {
    console.error("lib/makers.ts の MARKERS が data/parent/form-markers.json と違います。写しを直してください");
    process.exit(1);
  }
  const pm = JSON.parse(fs.readFileSync("data/parent/parent-master.json", "utf8")).products;
  const rows = pm.map((p) => [p.group, p.strength, p.brand_name, p.yj_code]);
  const code = `import { drugKey } from ${JSON.stringify(require("url").pathToFileURL(tsPath).href)};
    const rows = JSON.parse(require("fs").readFileSync(0, "utf8"));
    process.stdout.write(JSON.stringify(rows.map((r) => drugKey(...r))));`.replace('require("fs")', "(await import('node:fs'))");
  const out = require("child_process").execFileSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--input-type=module", "-e", code], { input: JSON.stringify(rows), encoding: "utf8", maxBuffer: 1 << 26 });
  const theirs = JSON.parse(out);
  const diff = rows.filter((r, i) => drugKey(...r) !== theirs[i]);
  if (diff.length) {
    console.error(`lib/makers.ts と鍵が違う製品 ${diff.length}：` + diff.slice(0, 5).map((r) => r[2]).join("、"));
    process.exit(1);
  }
  // scripts/ops/build-ops-master.py も同じ鍵か（python3 が無い環境では飛ばす）
  let py = null;
  try {
    py = JSON.parse(require("child_process").execFileSync("python3", ["-I", path.join(__dirname, "ops/build-ops-master.py"), "--keys"], { input: JSON.stringify(rows), encoding: "utf8", maxBuffer: 1 << 26 }));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (py) {
    const pyDiff = rows.filter((r, i) => drugKey(...r) !== py[i]);
    if (pyDiff.length) {
      console.error(`scripts/ops/build-ops-master.py と鍵が違う製品 ${pyDiff.length}：` + pyDiff.slice(0, 5).map((r) => r[2]).join("、"));
      process.exit(1);
    }
  }
}
