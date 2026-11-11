// 一般名処方の総当たり：鍵ごとに【般】の名前（錠・口腔内崩壊錠・カプセル・徐放錠・腸溶錠、補足 12時間持続／24時間持続 つき）を作り、
// 同じ成分（YJ 上 7 桁）・同じ規格の全製品を 1 つずつ採用品にして matchRx を呼ぶ。自動で選んだ製品の剤形が、名前の剤形と違う組を出す。
// 剤形は品質の読み方（販売名＋YJ の 8 桁目）。node general-sweep.mjs <リポジトリ>
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
const { MATCH_DATA: D } = await import(pathToFileURL(path.join(ROOT, "lib/match-data.ts")).href);
const { matchRx } = await import(pathToFileURL(path.join(ROOT, "lib/matching.ts")).href);
const pm = JSON.parse(fs.readFileSync(path.join(ROOT, "data/parent/parent-master.json"), "utf8")).products;
const prod = new Map(pm.map((p) => [p.brand_name, p]));
const MARK = JSON.parse(fs.readFileSync(path.join(ROOT, "data/parent/form-markers.json"), "utf8"));
const nk = (s) => String(s ?? "").normalize("NFKC").replace(/[\s　]/g, "");
const odRe = new RegExp(MARK.od.map((w) => (/^[A-Za-z]+$/.test(w) ? `(?<![A-Za-z])${w}[・-]?錠` : w)).join("|"));
/** 品質の剤形：OD／徐放:印／腸溶／チュアブル等／カプセル／錠 */
function cls(name, yj) {
  const b = nk(name).replace(/「[^」]*」/g, "").replace(/[（(][^）)]*[）)]/g, "");
  const c = yj?.[7];
  const cap = /カプセル/.test(b) || c === "M" || c === "N";
  if (/チュアブル|舌下|バッカル|分散|粒状|発泡|速崩/.test(b)) return "その他";
  if (/腸溶|EN錠/.test(b) || c === "H") return "腸溶";
  const rel = b.match(/(CR|SR|TR|LA|XR|ER|XL|L|R|U)(錠|カプセル)/)?.[1] ?? (/徐放|持続/.test(b) || c === "G" || c === "N" ? "徐放" : "");
  if (rel) return `徐放${cap ? "C" : ""}:${rel}`;
  if (odRe.test(b)) return "OD";
  return cap ? "カプセル" : "錠";
}
const kindOk = (kind, note, c) => {
  if (kind === "錠") return c === "錠" || c === "OD"; // 院内の決まり：普通の錠→OD 錠は可
  if (kind === "口腔内崩壊錠") return c === "OD";
  if (kind === "カプセル") return c === "カプセル";
  if (kind === "腸溶錠") return c === "腸溶";
  if (kind === "徐放錠") {
    if (!c.startsWith("徐放:")) return false;
    if (note === "12時間持続") return c === "徐放:L";
    if (note === "24時間持続") return c === "徐放:CR";
    return true;
  }
  return false;
};
const byGs = new Map();
for (const [n, ki] of D.products) { const [g, sk] = D.keys[ki].split("|"); const k = `${g.slice(0, 7)}|${sk}`; if (!byGs.has(k)) byGs.set(k, new Set()); byGs.get(k).add(n); }
const out = { names: 0, calls: 0, selected: 0, bad: [], badCandidates: [], ambiguousRelease: [] };
const seen = new Set();
for (const [k] of byGs) {
  const [g7, sk] = k.split("|");
  const group = Object.keys(D.generics).find((g) => g.startsWith(g7));
  const gen = group && D.generics[group];
  if (!gen || !/\d/.test(sk)) continue;
  const names = [...byGs.get(k)].filter((n) => prod.has(n));
  const unit = /μg|mEq|g$/.test(sk) ? "" : "mg";
  for (const kind of ["錠", "口腔内崩壊錠", "カプセル", "徐放錠", "腸溶錠"]) for (const note of kind === "徐放錠" ? [null, "12時間持続", "24時間持続", "12～24時間持続"] : [null]) {
    const gname = `【般】${gen}${kind}${sk}${unit}`;
    if (seen.has(gname + note)) continue;
    seen.add(gname + note);
    out.names++;
    const sel = [];
    for (const F of names) {
      const p = prod.get(F);
      out.calls++;
      const m = matchRx(gname, null, [{ id: F, brand_name: F, generic_name: "", strength: p.strength, adopted: true, product_key: p.product_key ?? F }], D, { nameNote: note });
      if (!m.best) {
        // 候補に出すだけでも、剤形・放出の違う製品は出さない
        if (m.candidates.length && !kindOk(kind, note, cls(F, p.yj_code))) out.badCandidates.push(`${gname}${note ? `（${note}）` : ""} → 候補 ${F}〈${cls(F, p.yj_code)}〉`);
        continue;
      }
      out.selected++;
      const c = cls(F, p.yj_code);
      sel.push(c);
      if (!kindOk(kind, note, c)) out.bad.push(`${gname}${note ? `（${note}）` : ""} → ${F}〈${c}〉`);
    }
    // 補足なしの徐放錠で、放出の型の違う製品のどれでも自動で選ぶ（ワントラム・ツートラムのような 1 日の回数違いは鍵で分からない）
    if (kind === "徐放錠" && !note && new Set(sel).size > 1) out.ambiguousRelease.push(`${gname} → ${[...new Set(sel)].join("・")}`);
  }
}
console.log(JSON.stringify(out));
