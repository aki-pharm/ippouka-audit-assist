// 最終の総当たり（品質）。node final-sweep.mjs <リポジトリ>
// (a) 読み違い：販売名から剤形・放出の印（CR・L・SR・LA・R・TR・徐放・腸溶・EN・OD・D など）を落とした名前で、
//     同じ成分・規格の全製品を 1 つずつ採用品にして呼ぶ。印を落とした名前が、徐放・腸溶・カプセル↔錠の違う製品を自動で選べば違反
//     （印が無いのに、元の名前より広く選ぶ）。メーカーも落とした名前でも試す
// (b) 麻薬・治療域の狭い薬：成分の全製品・全規格について、販売名・メーカーなし・【般】・印を落とした名前で、同じ成分の全製品（規格・剤形も全部）を採用品にして呼ぶ。
//     自動で選んだ製品の規格・剤形（品質の読み方）が処方と違えば違反
// (c) 安全側の取りこぼし：名前に印が無く YJ（統一名の行など）だけが徐放・腸溶を示す製品は、【般】…徐放錠／腸溶錠 で候補にも出ないことがある。その数と例
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
const { MATCH_DATA: D } = await import(pathToFileURL(path.join(ROOT, "lib/match-data.ts")).href);
const { matchRx } = await import(pathToFileURL(path.join(ROOT, "lib/matching.ts")).href);
const inData = new Set(D.products.map(([n]) => n));
const pm = JSON.parse(fs.readFileSync(path.join(ROOT, "data/parent/parent-master.json"), "utf8")).products.filter((p) => p.status !== "none" && inData.has(p.brand_name) && p.yj_code);
const MARK = JSON.parse(fs.readFileSync(path.join(ROOT, "data/parent/form-markers.json"), "utf8"));
const nk = (s) => String(s ?? "").normalize("NFKC").replace(/[\s　]/g, "");
const odRe = new RegExp(MARK.od.map((w) => (/^[A-Za-z]+$/.test(w) ? `(?<![A-Za-z])${w}[・-]?錠` : w)).join("|"));
const relWords = MARK.release.filter((w) => /^[A-Za-z]+$/.test(w));
function cls(p) {
  const b = nk(p.brand_name).replace(/「[^」]*」/g, "").replace(/[（(][^）)]*[）)]/g, "");
  const c = p.yj_code?.[7];
  const cap = /カプセル/.test(b) || c === "M" || c === "N";
  if (/チュアブル|舌下|バッカル|分散|粒状|発泡|速崩/.test(b)) return "その他";
  if (/腸溶|EN錠/.test(b) || c === "H") return "腸溶";
  const rel = b.match(new RegExp(`(${relWords.join("|")})(錠|カプセル)`))?.[1] ?? (/徐放|持続/.test(b) || c === "G" || c === "N" ? "徐放" : "");
  if (rel) return `徐放${cap ? "C" : ""}`;
  if (odRe.test(b)) return "OD";
  return cap ? "カプセル" : "錠";
}
const sn = (s) => nk(s).toLowerCase().replace(/(\d+)\.0+(?=\D|$)/, "$1").match(/\d+(\.\d+)?/g)?.join("/") ?? nk(s);
const fac = (p) => [{ id: p.brand_name, brand_name: p.brand_name, generic_name: "", strength: p.strength, adopted: true, product_key: p.product_key ?? p.brand_name }];
const byG7 = new Map();
for (const p of pm) { const g = p.yj_code.slice(0, 7); if (!byG7.has(g)) byG7.set(g, []); byG7.get(g).push(p); }
const sameStrength = (a, b) => sn(a.strength) === sn(b.strength);
const okClass = (want, got) => want === got || (want === "錠" && got === "OD");

// 印を落とす：販売名の剤形の直前の印、または「徐放」「腸溶」「口腔内崩壊」
const DROP = new RegExp(`(${[...MARK.release, ...MARK.od].filter((w) => w !== "D").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}|(?<=[^A-Za-z])D)(?=[・-]?(錠|カプセル))`);
const drops = (name) => {
  const n = nk(name);
  const out = new Set();
  if (DROP.test(n)) out.add(n.replace(DROP, "").replace(/・(?=錠)/, ""));
  for (const w of ["徐放", "腸溶", "口腔内崩壊"]) if (n.includes(w)) out.add(n.replace(w, ""));
  return [...out].filter((x) => x !== n);
};

const A = { tried: 0, bad: [] };
const realClass = new Map(); // メーカーなしの販売名 → 実在する製品の剤形（品質の読み方）
for (const p of pm) { const k = nk(p.brand_name).replace(/「[^」]*」/g, ""); realClass.set(k, new Set([...(realClass.get(k) ?? []), cls(p)])); }
for (const [, list] of byG7) {
  for (const P of list) {
    const dn = drops(P.brand_name);
    if (!dn.length) continue;
    for (const d of dn) for (const name of [d, d.replace(/「[^」]*」/g, "")]) {
      // 印を落とした名前の剤形（品質の読み方）：落としたあとの名前で読む
      const want = cls({ brand_name: name, yj_code: "" });
      for (const F of list) {
        if (!sameStrength(P, F)) continue;
        A.tried++;
        const m = matchRx(name, P.strength, fac(F), D);
        if (!m.best) continue;
        const got = cls(F);
        // 印を落とした名前が実在する製品の名前で、その製品も同じ剤形なら、読み違いではなく正しい名前（オメプラゾール錠10mg＝腸溶錠）
        if (realClass.get(name.replace(/「[^」]*」/g, ""))?.has(got)) continue;
        if (!okClass(want, got)) A.bad.push(`${P.brand_name} を「${name}」と読む → ${F.brand_name}〈${got}〉`);
      }
    }
  }
}

// (b)
const NARROW = ["オキシコドン", "モルヒネ", "フェンタニル", "タペンタドール", "ヒドロモルフォン", "トラマドール", "テオフィリン", "バルプロ酸", "カルバマゼピン", "炭酸リチウム", "ジゴキシン", "ワルファリン", "タクロリムス", "フェニトイン"];
const genericOf = (g7) => Object.entries(D.generics).find(([g]) => g.startsWith(g7))?.[1] ?? "";
const B = { ingredients: {}, tried: 0, bad: [] };
for (const [g7, list] of byG7) {
  const gen = genericOf(g7);
  const hit = NARROW.find((w) => gen.includes(w) || list.some((p) => p.brand_name.includes(w)));
  if (!hit || /配合/.test(gen)) continue;
  B.ingredients[hit] = (B.ingredients[hit] ?? 0) + list.length;
  for (const P of list) {
    const c = cls(P);
    const kind = { 錠: "錠", OD: "口腔内崩壊錠", カプセル: "カプセル", 徐放: "徐放錠", 徐放C: "徐放カプセル", 腸溶: "腸溶錠" }[c];
    const forms = [nk(P.brand_name), nk(P.brand_name).replace(/「[^」]*」/g, ""), ...drops(P.brand_name)];
    if (kind && gen) forms.push(`【般】${gen}${kind}${nk(P.strength).replace(/1(錠|カプセル)$/, "")}`);
    for (const name of new Set(forms)) {
      const want = name.startsWith("【般】") ? c : cls({ brand_name: name, yj_code: name === nk(P.brand_name) ? P.yj_code : "" });
      for (const F of list) {
        B.tried++;
        const m = matchRx(name, P.strength, fac(F), D);
        if (!m.best) continue;
        const got = cls(F);
        if (!sameStrength(P, F) || !okClass(want, got)) B.bad.push(`${name} → ${F.brand_name}〈${got}／${F.strength}〉`);
      }
    }
  }
}

// (c)
const csvF = fs.readdirSync(path.join(ROOT, "data/parent")).find((f) => /^naifuku-tablets-.*\.csv$/.test(f));
const unifiedRelease = new Map();
for (const l of fs.readFileSync(path.join(ROOT, "data/parent", csvF), "utf8").split("\n").slice(1)) {
  const c = l.split(",").map((x) => x.replace(/^"|"$/g, ""));
  if (c[4] === "" && /徐放|腸溶/.test(c[3])) unifiedRelease.set(c[0], /腸溶/.test(c[3]) ? "腸溶" : "徐放");
}
const C = { products: 0, miss: [] };
for (const p of pm) {
  const c = unifiedRelease.get(p.yj_code) ?? cls(p);
  if (c !== "徐放" && c !== "腸溶" && c !== "徐放C") continue;
  const b = nk(p.brand_name).replace(/「[^」]*」/g, "");
  if (new RegExp(`(${relWords.join("|")})(錠|カプセル)|徐放|持続|腸溶|EN錠`).test(b)) continue; // 名前に印がある
  const gen = genericOf(p.yj_code.slice(0, 7));
  if (!gen) continue;
  C.products++;
  const kind = c === "腸溶" ? "腸溶錠" : c === "徐放C" ? "徐放カプセル" : "徐放錠";
  const name = `【般】${gen}${kind}${nk(p.strength).replace(/1(錠|カプセル)$/, "")}`;
  for (const note of [null, "12～24時間持続"]) {
    if (note && kind !== "徐放錠") continue;
    const m = matchRx(name, p.strength, fac(p), D, { nameNote: note });
    if (!m.best && !m.candidates.length) C.miss.push(`${name}${note ? `（${note}）` : ""} → ${p.brand_name}（YJ ${p.yj_code}）は候補にも出ない`);
  }
}
console.log(JSON.stringify({ A, B, C }));
