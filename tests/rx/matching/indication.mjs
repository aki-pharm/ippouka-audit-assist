// 効能違いの印（TRE・EX・RE・AD・ZA・MT・AV）の製品どうしを全部組み、施設＝1 製品で matchRx を呼ぶ。
// 品質が決めた「効能の系列」（下の FAMILIES）が違うのに選んだ・候補に出した組を出す。node indication.mjs <リポジトリ>
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
// --agree：どの組にも「処方 → 採用品」の事前合意を渡す（合意で柵を越えないかを見る）
const AGREE = process.argv.includes("--agree");
const { MATCH_DATA: D } = await import(pathToFileURL(path.join(ROOT, "lib/match-data.ts")).href);
const { matchRx } = await import(pathToFileURL(path.join(ROOT, "lib/matching.ts")).href);
const pm = JSON.parse(fs.readFileSync(path.join(ROOT, "data/parent/parent-master.json"), "utf8")).products.filter((p) => p.status !== "none");
const nk = (s) => String(s).normalize("NFKC").replace(/[\s　]/g, "");
// 成分 → [系列, 当てはまる販売名の読み方]（先に当たったもの）。品質が添付文書の効能から決めた
const FAMILIES = {
  ゾニサミド: [["パーキンソン病（トレリーフ）", /トレリーフ|TRE/], ["てんかん（エクセグラン）", /エクセグラン|ゾニサミド/]],
  シルデナフィル: [["肺高血圧（レバチオ）", /レバチオ|RE「/], ["ED（バイアグラ）", /バイアグラ|シルデナフィル/]],
  タダラフィル: [["肺高血圧（アドシルカ）", /アドシルカ|AD「/], ["排尿障害（ザルティア）", /ザルティア|ZA「/], ["ED（シアリス）", /シアリス|タダラフィル/]],
  メトホルミン: [["メトグルコ（高用量まで）", /メトグルコ|MT「/], ["グリコラン（750mg/日まで）", /グリコラン|メトホルミン/]],
  デュタステリド: [["前立腺肥大（アボルブ）", /アボルブ|AV「/], ["AGA（ザガーロ）", /ザガーロ|ZA「/]],
};
const BRAND = { トレリーフ: "ゾニサミド", エクセグラン: "ゾニサミド", バイアグラ: "シルデナフィル", レバチオ: "シルデナフィル", シアリス: "タダラフィル", アドシルカ: "タダラフィル", ザルティア: "タダラフィル", メトグルコ: "メトホルミン", グリコラン: "メトホルミン", アボルブ: "デュタステリド", ザガーロ: "デュタステリド" };
const ingredientOf = (n) => Object.keys(FAMILIES).find((g) => n.includes(g)) ?? Object.entries(BRAND).find(([b]) => n.includes(b))?.[1];
const familyOf = (n) => FAMILIES[ingredientOf(n)].find(([, re]) => re.test(nk(n)))[0];
const strengthOf = (p) => nk(p.strength).replace(/\.0+(?=mg)/, "");
const list = pm.filter((p) => ingredientOf(p.brand_name) && !/（/.test(p.brand_name));
const fac = (p) => [{ id: p.brand_name, brand_name: p.brand_name, generic_name: "", strength: p.strength, adopted: true, product_key: p.product_key ?? p.brand_name }];
const rows = [];
for (const P of list) for (const F of list) {
  if (P === F || ingredientOf(P.brand_name) !== ingredientOf(F.brand_name) || strengthOf(P) !== strengthOf(F)) continue;
  const m = matchRx(P.brand_name, P.strength, fac(F), D, AGREE ? { agreements: [{ from: P.brand_name, to: F.brand_name, reason: "品質の走査", agreed_by: "品質", agreed_at: "2026-11-11" }] } : {});
  rows.push({ P: P.brand_name, F: F.brand_name, same: familyOf(P.brand_name) === familyOf(F.brand_name), pf: familyOf(P.brand_name), ff: familyOf(F.brand_name), best: m.best?.id ?? null, cand: m.candidates.length, note: m.note });
}
console.log(JSON.stringify(rows));
