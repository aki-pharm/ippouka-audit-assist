// lib/display.ts の刻印の種類（imprintKind）を、親マスタの全製品で品質が試す。
// node --no-warnings scan.mjs <リポジトリ> → JSON
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
const d = await import(pathToFileURL(path.join(ROOT, "lib/display.ts")).href);
const pm = JSON.parse(fs.readFileSync(path.join(ROOT, "data/parent/parent-master.json"), "utf8")).products;
const n = (s) => (s ?? "").normalize("NFKC");

/** 刻印の中の、名前・規格では説明できない英字・数字（見分けに使える記号）。英字は販売名にあるもの（OD・L など）も別に数える */
function extras(imprint, p) {
  const s = n(imprint);
  const nums = new Set((n(`${p.brand_name} ${p.strength ?? ""}`).match(/\d+(?:\.\d+)?/g) ?? []));
  const digits = (s.match(/\d+(?:\.\d+)?/g) ?? []).filter((x) => !nums.has(x));
  const latin = s.match(/[A-Za-z]+/g) ?? [];
  const brand = n(p.brand_name).toUpperCase();
  return { digits, latinInName: latin.filter((w) => brand.includes(w.toUpperCase())), latinOther: latin.filter((w) => !brand.includes(w.toUpperCase())) };
}

const out = { products: pm.length, sides: 0, kinds: {}, nameWithExtra: [], nameWithLatinInBrand: [], crossMaker: { tried: 0, hidden: [] } };
const nameSides = [];
for (const p of pm) for (const side of ["imprint_front", "imprint_back"]) {
  out.sides++;
  const k = d.imprintKind(p[side], p);
  out.kinds[k] = (out.kinds[k] ?? 0) + 1;
  if (k !== "name") continue;
  nameSides.push({ p, side });
  const e = extras(p[side], p);
  const row = { product: p.product_key, side, imprint: p[side], summary: d.imprintSummary(p) };
  if (e.digits.length || e.latinOther.length) out.nameWithExtra.push({ ...row, digits: e.digits, latin: e.latinOther });
  else if (e.latinInName.length) out.nameWithLatinInBrand.push({ ...row, latin: e.latinInName });
}
out.nameSides = nameSides.length;

// 他社の名前印字：同じ成分（group）・別メーカーの製品の名前印字を、この製品の刻印として判定する。
// 他社の印字はこの製品の名前ではないので「名前印字」に隠れてはいけない（刻印の取り違え・マスタの誤記を見落とす）
const byGroup = new Map();
for (const x of nameSides) byGroup.set(x.p.group, [...(byGroup.get(x.p.group) ?? []), x]);
const makerTag = (p) => (n(p.brand_name).match(/「([^」]+)」/) ?? [])[1] ?? n(p.maker);
for (const p of pm) for (const x of byGroup.get(p.group) ?? []) {
  if (x.p.maker === p.maker || makerTag(x.p) === makerTag(p)) continue;
  if (n(x.p[x.side]).replace(/\s/g, "") === n(p.imprint_front).replace(/\s/g, "")) continue;
  // 他社の印字のうち、この製品の名前・規格で説明できない部分（かな・漢字の他社名、英字の記号、規格と違う数字）があるものだけを試す
  // （成分名と規格だけの印字は、この製品に読んでも名前印字で正しい）
  const imp = x.p[x.side];
  const own = n(`${p.brand_name}${p.maker ?? ""}`).replace(/\s/g, "");
  const jaForeign = (n(imp).match(/[ぁ-ゖァ-ヺー一-鿿々]+/g) ?? []).filter((w) => [...w].length >= 2 && !own.includes(w));
  const e = extras(imp, p);
  const why = [...(jaForeign.length ? [`他社名 ${jaForeign.join("・")}`] : []), ...(e.latinOther.length ? [`記号 ${e.latinOther.join("・")}`] : []), ...(e.digits.length ? [`数字 ${e.digits.join("・")}`] : [])];
  if (!why.length) continue;
  out.crossMaker.tried++;
  if (d.imprintKind(imp, p) === "name") out.crossMaker.hidden.push({ product: p.product_key, foreignImprint: imp, from: x.p.product_key, why: why.join("／"), jaForeign: jaForeign.length > 0 });
}
out.crossMaker.hiddenCount = out.crossMaker.hidden.length;
out.crossMaker.hiddenJaForeign = out.crossMaker.hidden.filter((h) => h.jaForeign).length;
out.crossMaker.hiddenProducts = new Set(out.crossMaker.hidden.map((h) => h.product)).size;

// 決まった例（他社名・別の成分・名前の頭 2 文字だけ同じ語）
const P = (brand, maker) => ({ brand_name: brand, maker });
out.cases = Object.fromEntries([
  ["自社の名前印字", "ラベプラ 10 オーハラ", P("ラベプラゾールNa錠10mg「オーハラ」", "大原薬品工業株式会社")],
  ["他社名（トーワの錠にオーハラ）", "ラベプラ 10 オーハラ", P("ラベプラゾールNa錠10mg「トーワ」", "東和薬品株式会社")],
  ["他社名・頭 2 文字だけ同じ（トーワの錠にトーアエイヨー）", "アムロジピン 5 トーアエイヨー", P("アムロジピン錠5mg「トーワ」", "東和薬品株式会社")],
  ["別の成分・頭 2 文字だけ同じ（アムロジピンにアムバロ）", "アムバロ", P("アムロジピン錠5mg「トーワ」", "東和薬品株式会社")],
  ["別の成分（アムロジピンにニフェジピン）", "ニフェジピン 10", P("アムロジピン錠5mg「トーワ」", "東和薬品株式会社")],
  ["名前＋記号（記号が隠れる）", "アムロジピン TW 5", P("アムロジピン錠5mg「トーワ」", "東和薬品株式会社")],
  ["名前＋規格と違う数字", "アムロジピン 10 トーワ", P("アムロジピン錠5mg「トーワ」", "東和薬品株式会社")],
  ["自社名＋記号だけ（JG C31）", "JG C31", P("アムロジピン錠5mg「JG」", "日本ジェネリック株式会社")],
  ["自社名＋数字だけ（YD 550）", "YD 550", P("アムロジピン錠5mg「YD」", "株式会社陽進堂")],
  ["英字だけ（OD）", "OD 5", P("アムロジピンOD錠5mg「トーワ」", "東和薬品株式会社")],
  ["行で分けた名前（カンデ8 サルタン）", "カンデ8 サルタン", P("カンデサルタン錠8mg「トーワ」", "東和薬品株式会社")],
  ["後ろ半分が別の薬（ロサルタンの錠に「カンデ サルタン」）", "カンデ サルタン 50", P("ロサルタンカリウム錠50mg「トーワ」", "東和薬品株式会社")],
  ["区切りの「/」", "ゾルピデム 10 / ゾルピデム 10KMP", P("ゾルピデム酒石酸塩錠10mg「KMP」", "共創未来ファーマ株式会社")],
  ["名前＋記号（SW）", "SW オランザピン 10", P("オランザピン錠10mg「サワイ」", "沢井製薬株式会社")],
].map(([k, imp, p]) => [k, { imprint: imp, kind: d.imprintKind(imp, p), summary: d.imprintSummary({ ...p, imprint_front: imp, imprint_back: "なし" }) }]));

// ---------- d051ce2 の語ごとの見せ方を、品質の別の読み方で確かめる ----------
// 品質の「自身の名前」：語（空白区切り）を頭から、規格の数字（単位つきも）・販売名の英字・自社の「」の名前・
// 販売名（「」と（）を除く）の中の、かな・漢字を含む 3 文字以上の連続した部分・区切りの記号、で全部説明できる語。
// アプリ（頭からの一致・後ろ半分）より緩い（どこの部分でもよい）ので、品質の読みで「自身の名前でない」語は、アプリでも名前ではないはず
const SEP = /^[\/・\-－ー.,、。:：]+$/;
function ownOf(p) {
  const brand = n(p.brand_name);
  const nums = new Set([...(brand.match(/\d+(?:\.\d+)?/g) ?? []), ...(n(p.strength).match(/\d+(?:\.\d+)?/g) ?? [])]);
  const tag = ((brand.match(/「([^」]+)」/) ?? [])[1] ?? "").replace(/\s/g, "").toUpperCase();
  const plain = brand.replace(/「[^」]*」/g, "").replace(/\([^)]*\)/g, "").replace(/\s/g, "").toUpperCase();
  const latin = new Set(plain.replace(/\d+(?:\.\d+)?(MG|ΜG|G)/g, " ").match(/[A-Z]+/g) ?? []);
  return { nums, tag, plain, latin };
}
function qaOwn(token, o) {
  const t = n(token).toUpperCase();
  if (SEP.test(t)) return { own: true, ja: false, sep: true };
  const reach = Array(t.length + 1).fill(false), ja = Array(t.length + 1).fill(false);
  reach[0] = true;
  for (let i = 0; i < t.length; i++) {
    if (!reach[i]) continue;
    const rest = t.slice(i), go = (len, isJa) => { reach[i + len] = true; if (isJa || ja[i]) ja[i + len] = true; };
    const m = rest.match(/^\d+(?:\.\d+)?/);
    if (m && o.nums.has(m[0])) { go(m[0].length, false); const u = rest.slice(m[0].length).match(/^(MG|ΜG|G|番|号)/); if (u) go(m[0].length + u[0].length, false); }
    const l = rest.match(/^[A-Z]+/);
    if (l && o.latin.has(l[0])) go(l[0].length, false);
    if (o.tag && rest.startsWith(o.tag)) go(o.tag.length, false);
    for (let k = Math.min(rest.length, o.plain.length); k >= 1; k--) {
      const sub = rest.slice(0, k);
      if (/[ぁ-ゖァ-ヺ一-鿿々]/.test(sub) && (k >= 3 || sub === o.plain) && o.plain.includes(sub)) go(k, true);
    }
  }
  return { own: reach[t.length], ja: ja[t.length], sep: false };
}
/** 1 面ずつ：出した文字（imprintDisplay の front・back）から、落とした語を数える */
const tok = { sides: 0, droppedTokens: 0, droppedNotOwn: [], droppedNoJa: {}, droppedSep: 0, sepExamples: [], wholeNoName: 0, wholeNoNameBad: [], aloneLatin: [], suffix: [] };
function checkSide(p, imprint, shown, where) {
  const words = (imprint ?? "").trim().split(/[\s　]+/).filter(Boolean);
  if (!words.length || imprint === "未確認" || imprint === "なし") return;
  const o = ownOf(p);
  const shownText = shown == null ? "" : n(shown);
  // 出した文字の語（「（名前印字）」を除く）を、元の語と順に照らす
  const shownWords = shownText.replace(/[（(]名前印字[）)]$/, "").split(/\s+/).filter(Boolean);
  const dropped = [];
  let j = 0;
  for (const w of words) { if (j < shownWords.length && shownWords[j] === n(w)) j++; else dropped.push(w); }
  if (j !== shownWords.length) (out.tokens.mismatch ??= []).push({ product: p.product_key, where, imprint, shown });
  tok.droppedTokens += dropped.length;
  for (const w of dropped) {
    const q = qaOwn(w, o);
    if (q.sep) { tok.droppedSep++; if (tok.sepExamples.length < 8) tok.sepExamples.push({ product: p.product_key, imprint, shown }); continue; }
    if (!q.own) tok.droppedNotOwn.push({ product: p.product_key, where, imprint, token: w, shown });
    else if (!/[ぁ-ゖァ-ヺ一-鿿々]/.test(n(w))) tok.droppedNoJa[n(w)] = (tok.droppedNoJa[n(w)] ?? 0) + 1;
  }
  // 成分名・販売名の語が 1 つも無い刻印（「JG C31」「YD 550」「5」）は全部出す
  const anyJaOwn = words.some((w) => { const q = qaOwn(w, o); return q.own && q.ja; });
  if (!anyJaOwn) { tok.wholeNoName++; if (dropped.length) tok.wholeNoNameBad.push({ product: p.product_key, where, imprint, shown }); }
  // 販売名の英字だけの刻印（OD・LD・TRE など）は名前印字にしない
  if (words.every((w) => /^[A-Za-z]+$/.test(n(w)) || /^\d+(?:\.\d+)?$/.test(n(w))) && shown == null) tok.aloneLatin.push({ product: p.product_key, where, imprint });
  // 後ろ半分の名前（「カンデ8 サルタン」の「サルタン」）で落とした語：販売名の頭からではない部分
  for (const w of dropped) {
    const runs = n(w).toUpperCase().match(/[ぁ-ゖァ-ヺー一-鿿々]+/g) ?? [];
    if (runs.some((r) => !o.plain.startsWith(r) && r !== o.tag && o.plain.includes(r))) tok.suffix.push({ product: p.product_key, imprint, token: w, shown });
  }
}
out.tokens = tok;
for (const p of pm) {
  const disp = d.imprintDisplay(p);
  tok.sides++;
  checkSide(p, p.imprint_front, disp.nameTag ? null : disp.front, "表");
  const same = n(p.imprint_front).replace(/\s/g, "") === n(p.imprint_back).replace(/\s/g, "");
  if (!same) { tok.sides++; checkSide(p, p.imprint_back, disp.back, "裏"); }
}
// 他社の印字を当てたとき、落とす語が品質の読みで自身の名前か
const foreign = { tried: 0, droppedNotOwn: [] };
for (const p of pm) for (const x of byGroup.get(p.group) ?? []) {
  if (x.p.product_key === p.product_key || makerTag(x.p) === makerTag(p)) continue;
  const imp = x.p[x.side];
  foreign.tried++;
  const q = { ...p, imprint_front: imp, imprint_back: "なし" };
  const disp = d.imprintDisplay(q);
  const shown = disp.nameTag ? "" : n(disp.front ?? "").replace(/[（(]名前印字[）)]$/, "");
  const sw = shown.split(/\s+/).filter(Boolean);
  let j = 0;
  for (const w of imp.trim().split(/[\s　]+/).filter(Boolean)) {
    if (j < sw.length && sw[j] === n(w)) { j++; continue; }
    if (!qaOwn(w, ownOf(p)).own) foreign.droppedNotOwn.push({ product: p.product_key, foreignImprint: imp, from: x.p.product_key, token: w, shown: disp.nameTag ? "名前印字" : disp.front });
  }
}
out.tokens.foreign = { tried: foreign.tried, droppedNotOwnCount: foreign.droppedNotOwn.length, droppedNotOwn: foreign.droppedNotOwn.slice(0, 50) };
// 別の成分で名前の後ろ 3 文字が同じ製品（〜サルタン・〜プラゾール・〜スタチンなど）の名前印字を当てる（後ろ半分の決まりで他の薬の語が落ちないか）
const tail = (p) => { const b = cardName0(p.brand_name); return b.length >= 4 ? b.slice(-3) : null; };
function cardName0(brand) { return d.cardName(brand).base.normalize("NFKC").replace(/\s/g, "").toUpperCase(); }
const byTail = new Map();
for (const x of nameSides) { const k = tail(x.p); if (k) byTail.set(k, [...(byTail.get(k) ?? []), x]); }
const other = { tried: 0, droppedNotOwn: [] };
for (const p of pm) for (const x of byTail.get(tail(p)) ?? []) {
  if (x.p.group === p.group) continue;
  const imp = x.p[x.side];
  other.tried++;
  const disp = d.imprintDisplay({ ...p, imprint_front: imp, imprint_back: "なし" });
  const shown = disp.nameTag ? "" : n(disp.front ?? "").replace(/[（(]名前印字[）)]$/, "");
  const sw = shown.split(/\s+/).filter(Boolean);
  let j = 0;
  for (const w of imp.trim().split(/[\s　]+/).filter(Boolean)) {
    if (j < sw.length && sw[j] === n(w)) { j++; continue; }
    if (!qaOwn(w, ownOf(p)).own || disp.nameTag) other.droppedNotOwn.push({ product: p.product_key, foreignImprint: imp, from: x.p.product_key, token: w, shown: disp.nameTag ? "名前印字" : disp.front });
  }
}
out.tokens.otherDrug = { tried: other.tried, droppedNotOwnCount: other.droppedNotOwn.length, droppedNotOwn: other.droppedNotOwn.slice(0, 60) };
out.tokens.droppedNotOwnCount = tok.droppedNotOwn.length;

out.nameWithExtraCount = out.nameWithExtra.length;
out.nameWithExtraProducts = new Set(out.nameWithExtra.map((x) => x.product)).size;
console.log(JSON.stringify(out));
