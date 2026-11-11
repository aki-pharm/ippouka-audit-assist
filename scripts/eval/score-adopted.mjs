/**
 * 段階 2「採用品の選択」の採点：読み取った薬品名から、アプリの照合（lib/master.ts の matchTablet）が正しい院内採用品を選ぶか。
 *
 *   node scripts/eval/score-adopted.mjs                                    正解の読み取り（API 不要）で選択だけを採点
 *   node scripts/eval/score-adopted.mjs --results captures/rx-runs/<モデル> 読み取り結果でも採点し、正解の読み取りと並べる
 *   オプション：--facility <施設のマスタ.json>（既定 data/rx-testset/facility.json）
 *              --expected-adopted <正解.csv>（既定 data/rx-testset/expected-adopted.csv）
 *              --expected <正解の読み取りのフォルダ>（既定 data/rx-testset/expected）
 *              --out <出力の頭>（既定 reports/score-adopted）
 *              --private：数だけを画面に出す。ファイルは書かない・薬品名は出さない（確認係が data/private の施設マスタで動かす用）
 *
 * アプリの照合をそのまま使う：lib/master.ts を書き換えずに読み込み、`@/data/master.json` だけを施設のマスタに差し替える
 * （scripts/eval/adopted-hooks.mjs）。Node の TypeScript 読み込み（--experimental-strip-types）が要る。無ければ自分で付け直して起動し直す。
 *
 * 施設のマスタ：JSON の配列、または { products: [...] }。1 件に brand_name・generic_name・strength・adopted が必要。
 *   id（無ければ brand_name）、maker、aliases（処方箋での別表記）、maker_state（今のメーカーの状態）は任意。
 * 正解（CSV）：列 rx, rp, expected, pending_product, cases。expected は 採用品の id／「採用なし」／「メーカー未確定」。
 *   メーカー未確定のときは pending_product に、選ばれるべき薬（メーカーが決まっていない行）の id。
 *
 * 判定（1 行ごと）
 *   正しい製品／正しく採用なし／正しく未確定
 *   誤った製品（種類：OD とふつうの錠、放出（CR・L・徐放など）、規格、メーカー、採用中止の製品、別の薬）
 *   該当なしと出た（正解は採用品があるのに、候補が 0）
 *   候補が複数（自動で 1 つに決まらない。正解が候補に含まれるか）
 *   採用なしなのに選んだ／採用なしなのに候補を出した
 *   読み取りで抜け（--results のときだけ）
 * メーカー未確定：アプリの照合で選ばれた採用品の maker_state が「未選択」か「両方」を含むなら未確定とする
 *   （feature/maker-select の lib/makers.ts の isMakerUnknown と同じ決まり。main のアプリはまだこの表示を持たない）
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "../..");

// Node の TypeScript 読み込みを付け、警告を消して起動し直す（lib/master.ts を読むため）
if (!process.env.SCORE_ADOPTED_CHILD) {
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", __filename, ...process.argv.slice(2)], { stdio: "inherit", env: { ...process.env, SCORE_ADOPTED_CHILD: "1" } });
  process.exit(r.status ?? 1);
}

const require = createRequire(import.meta.url);
const { align, loadResult, parseKey } = require("./score-rx.cjs");
const { parseCsv, csvCell, mdTable } = require("./lib.cjs");

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const PRIVATE = process.argv.includes("--private");
const facilityFile = path.resolve(arg("--facility", path.join(ROOT, "data/rx-testset/facility.json")));
const expectedAdoptedFile = path.resolve(arg("--expected-adopted", path.join(ROOT, "data/rx-testset/expected-adopted.csv")));
const expectedDir = path.resolve(arg("--expected", path.join(ROOT, "data/rx-testset/expected")));
const resultsDir = arg("--results") ? path.resolve(arg("--results")) : null;
const outBase = path.resolve(arg("--out", path.join(ROOT, "reports/score-adopted")));
const rel = (p) => (PRIVATE ? path.basename(p) : path.relative(ROOT, p));

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

// ---------- 施設のマスタ ----------
let facilityRaw;
try {
  facilityRaw = JSON.parse(fs.readFileSync(facilityFile, "utf8"));
} catch (e) {
  fail(`施設のマスタが読めない: ${rel(facilityFile)}（${e.message.slice(0, 80)}）`);
}
const facilityList = Array.isArray(facilityRaw) ? facilityRaw : facilityRaw?.products;
if (!Array.isArray(facilityList) || !facilityList.length) fail("施設のマスタに製品が無い（配列か { products: [...] }）");
const bad = facilityList.filter((p) => !p || typeof p.brand_name !== "string" || typeof p.generic_name !== "string" || typeof p.strength !== "string" || typeof p.adopted !== "boolean");
if (bad.length) fail(`施設のマスタに brand_name・generic_name・strength（文字）・adopted（真偽）が無い製品が ${bad.length} 件`);
const facility = facilityList.map((p) => ({ ...p, id: p.id ?? p.brand_name, aliases: Array.isArray(p.aliases) ? p.aliases : [] }));
const ids = new Set();
for (const p of facility) {
  if (ids.has(p.id)) fail(`施設のマスタの id が重複: ${PRIVATE ? "（名前は出さない）" : p.id}`);
  ids.add(p.id);
}
const byId = new Map(facility.map((p) => [p.id, p]));

// アプリの lib/master.ts を、施設のマスタで読み込む
register(pathToFileURL(path.join(ROOT, "scripts/eval/adopted-hooks.mjs")), {
  parentURL: import.meta.url,
  data: { facilityModule: "data:text/javascript," + encodeURIComponent(`export default ${JSON.stringify(facility)};`) },
});
const app = await import(pathToFileURL(path.join(ROOT, "lib/master.ts")).href);

// ---------- 正解 ----------
const [eh, ...er] = parseCsv(fs.readFileSync(expectedAdoptedFile, "utf8")).filter((r) => r.length > 1);
const expRows = er.map((r) => Object.fromEntries(eh.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
for (const k of ["rx", "rp", "expected"]) if (!eh.map((h) => h.trim()).includes(k)) fail(`正解の CSV に列 ${k} が無い`);
const expReads = new Map();
for (const f of fs.readdirSync(expectedDir).filter((f) => f.endsWith(".expected.json"))) {
  expReads.set(f.replace(/\.expected\.json$/, ""), JSON.parse(fs.readFileSync(path.join(expectedDir, f), "utf8")));
}
for (const e of expRows) {
  const rx = expReads.get(e.rx);
  if (!rx || !rx.items.some((it) => it.rp === e.rp)) fail(`正解の読み取りに無い行: ${e.rx} Rp${e.rp}`);
  if (e.expected !== "採用なし" && e.expected !== "メーカー未確定" && !byId.has(e.expected)) fail(`正解の採用品が施設のマスタに無い: ${e.rx} Rp${e.rp}${PRIVATE ? "" : ` ${e.expected}`}`);
  if (e.expected === "メーカー未確定" && !byId.has(e.pending_product)) fail(`メーカー未確定の行の pending_product が施設のマスタに無い: ${e.rx} Rp${e.rp}`);
}

// ---------- 判定 ----------
const isMakerUnknown = (state) => !!state && (state === "未選択" || String(state).includes("両方"));
const CAT = {
  ok_product: "正しい製品",
  ok_none: "正しく採用なし",
  ok_pending: "正しく未確定",
  wrong_product: "誤った製品",
  wrong_none: "該当なしと出た（正解は採用品あり）",
  ambiguous: "候補が複数（自動で決まらない）",
  selected_for_none: "採用なしなのに選んだ",
  candidates_for_none: "採用なしなのに候補を出した",
  pending_missed: "未確定のはずが製品を選んだ",
  pending_extra: "未確定でないのに未確定",
  missing: "読み取りで抜け",
};
const OK = new Set(["ok_product", "ok_none", "ok_pending"]);

const nfkc = (s) => String(s ?? "").normalize("NFKC").replace(/[\s　]/g, "").toLowerCase();
const hasOD = (s) => /od錠|口腔内崩壊|(^|[^a-z])d錠/.test(nfkc(s));
const releaseOf = (s) => {
  const n = nfkc(s).replace(/[「『][^」』]*[」』]/g, "");
  const m = n.match(/(cr|l|sr|la|r|xr|er)錠|徐放|腸溶/);
  return m ? m[0] : "";
};
const makerless = (s) => nfkc(s).replace(/[「『][^」』]*[」』]/g, "");

/** 誤った製品の種類（正解の製品 e と選ばれた製品 s） */
function wrongKind(e, s) {
  const kinds = [];
  if (s.adopted === false) kinds.push("採用中止の製品");
  if (nfkc(e.generic_name) !== nfkc(s.generic_name)) kinds.push("別の薬");
  else {
    if (hasOD(e.brand_name) !== hasOD(s.brand_name)) kinds.push("OD とふつうの錠");
    if (releaseOf(e.brand_name) !== releaseOf(s.brand_name)) kinds.push("放出（CR・L・徐放など）");
    if (nfkc(e.strength) !== nfkc(s.strength)) kinds.push("規格");
    if (!kinds.length && makerless(e.brand_name) === makerless(s.brand_name)) kinds.push("メーカー");
    if (!kinds.length) kinds.push("同じ成分の別製品");
  }
  return kinds.join("・");
}

/** 1 行の判定。name・strength・nameNote はアプリに渡す読み取りの値（nameNote＝括弧の補足。徐放錠の一般名処方で 12時間／24時間 を決める） */
function judge(e, name, strength, nameNote = null) {
  if (name == null) return { category: "missing", kind: "", selected: "", candidates: 0 };
  const m = app.matchTablet(String(name), strength ?? null, { nameNote: nameNote ?? null });
  const best = m.best ? byId.get(m.best.id) : null;
  const cands = m.candidates.map((c) => c.id);
  const out = { selected: best?.id ?? "", candidates: cands.length, kind: "", substituted: !!m.substituted };
  const want = e.expected;
  if (!best) {
    if (!cands.length) out.category = want === "採用なし" ? "ok_none" : "wrong_none";
    else if (want === "採用なし") out.category = "candidates_for_none";
    else {
      out.category = "ambiguous";
      const target = want === "メーカー未確定" ? e.pending_product : want;
      out.kind = cands.includes(target) ? "正解が候補にある" : "正解が候補に無い";
    }
    return out;
  }
  const pending = isMakerUnknown(best.maker_state);
  if (want === "採用なし") {
    out.category = "selected_for_none";
    out.kind = best.adopted === false ? "採用中止の製品" : "採用品";
  } else if (want === "メーカー未確定") {
    if (best.id === e.pending_product) out.category = pending ? "ok_pending" : "pending_missed";
    else { out.category = "wrong_product"; out.kind = wrongKind(byId.get(e.pending_product), best); }
  } else if (best.id === want) {
    out.category = pending ? "pending_extra" : best.adopted === false ? "wrong_product" : "ok_product";
    if (best.adopted === false) out.kind = "採用中止の製品";
  } else {
    out.category = "wrong_product";
    out.kind = wrongKind(byId.get(want), best);
  }
  return out;
}

// 正解の読み取りで
const truth = expRows.map((e) => {
  const it = expReads.get(e.rx).items.find((x) => x.rp === e.rp);
  return { e, name: it.name_as_written, ...judge(e, it.name_as_written, it.strength, it.name_note) };
});

// 読み取り結果で（任意）
const readRuns = [];
if (resultsDir) {
  const files = fs.readdirSync(resultsDir).filter((f) => f.endsWith(".json")).sort();
  const byKey = new Map();
  for (const f of files) {
    const [head, ...rest] = f.replace(/\.json$/, "").split("__");
    const pm = head.match(/^(.*?)-(\d+)$/);
    const key = [pm ? pm[1] : head, ...rest].join("__");
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push({ file: f, page: pm ? Number(pm[2]) : 0 });
  }
  for (const [key, all] of byKey) {
    // まとめたファイルとページごとのファイルが両方あれば、まとめたファイルだけ（score-rx.cjs と同じ）
    const parts = all.some((x) => x.page === 0) ? all.filter((x) => x.page === 0) : all;
    const info = parseKey(key);
    const exp = expReads.get(info.rx);
    if (!exp) continue;
    const loaded = parts.sort((a, b) => a.page - b.page).map((x) => loadResult(path.join(resultsDir, x.file)));
    const pred = loaded.filter((l) => l.res).flatMap((l) => l.res.items);
    const map = align(exp.items, pred);
    for (const e of expRows.filter((x) => x.rx === info.rx)) {
      const i = exp.items.findIndex((x) => x.rp === e.rp);
      const p = map[i] >= 0 ? pred[map[i]] : null;
      readRuns.push({ key, info, e, name: p?.name_as_written ?? null, ...judge(e, p?.name_as_written ?? null, p?.strength ?? null, p?.name_note ?? null) });
    }
  }
}

// ---------- 集計 ----------
const countBy = (list, f) => list.reduce((m, x) => m.set(f(x), (m.get(f(x)) ?? 0) + 1), new Map());
function summary(list) {
  const c = countBy(list, (x) => x.category);
  const ok = list.filter((x) => OK.has(x.category)).length;
  return { n: list.length, ok, c };
}
const catRows = (s) => Object.keys(CAT).filter((k) => s.c.get(k)).map((k) => [CAT[k], s.c.get(k)]);
const kindRows = (list) => [...countBy(list.filter((x) => x.kind && !OK.has(x.category)), (x) => `${CAT[x.category]}：${x.kind}`)].sort((a, b) => b[1] - a[1]);
const caseRows = (list) => {
  const m = new Map();
  for (const x of list) for (const c of (x.e.cases || "-").split(" ")) {
    const v = m.get(c) ?? [0, 0];
    v[0]++;
    if (OK.has(x.category)) v[1]++;
    m.set(c, v);
  }
  return [...m].sort().map(([c, [n, ok]]) => [c, n, ok, `${((100 * ok) / n).toFixed(1)}%`]);
};
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : "-");
const sT = summary(truth);
const pendingRows = truth.filter((x) => x.category === "ok_pending").length;

if (PRIVATE) {
  console.log(`段階 2（採用品の選択）・施設のマスタ ${facility.length} 件・正解の行 ${sT.n}`);
  console.log(`正解の読み取りで：正しい ${sT.ok}/${sT.n}（${pct(sT.ok, sT.n)}）`);
  for (const [k, v] of catRows(sT)) console.log(`  ${k} ${v}`);
  for (const [k, v] of kindRows(truth)) console.log(`  （内訳）${k} ${v}`);
  if (readRuns.length) {
    const sR = summary(readRuns);
    console.log(`読み取り結果で：正しい ${sR.ok}/${sR.n}（${pct(sR.ok, sR.n)}）`);
    for (const [k, v] of catRows(sR)) console.log(`  ${k} ${v}`);
  }
  process.exit(0);
}

const md = [];
md.push("# 段階 2：採用品の選択の採点（架空施設）", "");
md.push(`- 施設のマスタ：\`${rel(facilityFile)}\`（${facility.length} 件、採用中止 ${facility.filter((p) => p.adopted === false).length}、メーカー未確定 ${facility.filter((p) => isMakerUnknown(p.maker_state)).length}、別名あり ${facility.filter((p) => p.aliases.length).length}）`);
md.push(`- 正解：\`${rel(expectedAdoptedFile)}\`（${expRows.length} 行）。照合はアプリの \`lib/master.ts\` の matchTablet をそのまま使った（\`node scripts/eval/score-adopted.mjs\`、決まりはスクリプト先頭）`);
md.push(`- 作成：${new Date().toISOString()}`);
md.push(`- メーカー未確定の判定は feature/maker-select の決まり（maker_state が「未選択」か「両方」）。**main のアプリはまだ表示できない**ので、main では「正しく未確定」の ${pendingRows} 行もそのまま製品として描かれる`);
md.push("", "## 正解の読み取りで（読み取りの誤りを含まない、選択だけの正しさ）", "");
md.push(`正しい ${sT.ok}/${sT.n}（${pct(sT.ok, sT.n)}）。正しい製品のうち、アプリが「置き換え」（処方箋の表記と違う採用品）として出すもの ${truth.filter((x) => x.category === "ok_product" && x.substituted).length}`, "");
md.push(mdTable(["判定", "行"], catRows(sT)));
const kT = kindRows(truth);
if (kT.length) md.push("", mdTable(["誤りの種類", "行"], kT));
md.push("", "### 狙い別", "", mdTable(["狙い", "行", "正しい", "正解率"], caseRows(truth)));
const wrongT = truth.filter((x) => !OK.has(x.category));
md.push("", `### 正しくない行（${wrongT.length}）`, "");
md.push(wrongT.length ? mdTable(["処方", "Rp", "処方箋の名前", "正解", "アプリが選んだ", "候補の数", "判定", "種類"], wrongT.map((x) => [x.e.rx, x.e.rp, x.name, x.e.expected === "メーカー未確定" ? `メーカー未確定（${x.e.pending_product}）` : x.e.expected, x.selected || "（なし）", x.candidates, CAT[x.category], x.kind])) : "なし");
if (readRuns.length) {
  const sR = summary(readRuns);
  md.push("", `## 読み取り結果で（\`${rel(resultsDir)}\`、${new Set(readRuns.map((x) => x.key)).size} 撮影）`, "");
  md.push(`正しい ${sR.ok}/${sR.n}（${pct(sR.ok, sR.n)}）`, "");
  md.push(mdTable(["判定", "行"], catRows(sR)));
  const kR = kindRows(readRuns);
  if (kR.length) md.push("", mdTable(["誤りの種類", "行"], kR));
  // 正解の読み取りでは正しいのに、読み取り結果では正しくない＝読み取りの誤りが選択を変えた
  const truthOk = new Map(truth.map((x) => [`${x.e.rx}|${x.e.rp}`, OK.has(x.category)]));
  const byRead = readRuns.filter((x) => truthOk.get(`${x.e.rx}|${x.e.rp}`) && !OK.has(x.category));
  const bySel = readRuns.filter((x) => !truthOk.get(`${x.e.rx}|${x.e.rp}`) && !OK.has(x.category));
  md.push("", mdTable(["正しくない行の原因", "行"], [["読み取りの誤り（正解の読み取りなら正しく選べる行）", byRead.length], ["選択の誤り（正解の読み取りでも選べない行）", bySel.length]]));
  md.push("", "### 狙い別", "", mdTable(["狙い", "行", "正しい", "正解率"], caseRows(readRuns)));
  md.push("", `### 読み取りの誤りで選択が変わった行（最大 40／${byRead.length}）`, "");
  md.push(byRead.length ? mdTable(["撮影", "Rp", "読んだ名前", "正解", "アプリが選んだ", "判定", "種類"], byRead.slice(0, 40).map((x) => [x.key, x.e.rp, x.name ?? "（抜け）", x.e.expected, x.selected || "（なし）", CAT[x.category], x.kind])) : "なし");
}
md.push("");
fs.mkdirSync(path.dirname(outBase), { recursive: true });
fs.writeFileSync(`${outBase}.md`, md.join("\n"));
const head = ["source", "rx", "rp", "name_used", "expected", "pending_product", "selected", "candidates", "substituted", "category", "kind", "cases"];
const line = (src, x) => [src, x.e.rx, x.e.rp, x.name ?? "", x.e.expected, x.e.pending_product ?? "", x.selected, x.candidates, x.substituted ? 1 : 0, x.category, x.kind, x.e.cases].map(csvCell).join(",");
fs.writeFileSync(`${outBase}-rows.csv`, "﻿" + [head.join(","), ...truth.map((x) => line("truth", x)), ...readRuns.map((x) => line(x.key, x))].join("\n") + "\n");
console.log(`正解の読み取りで：正しい ${sT.ok}/${sT.n}（${pct(sT.ok, sT.n)}）　${catRows(sT).map(([k, v]) => `${k} ${v}`).join("、")}`);
if (readRuns.length) { const sR = summary(readRuns); console.log(`読み取り結果で：正しい ${sR.ok}/${sR.n}（${pct(sR.ok, sR.n)}）`); }
console.log(`→ ${rel(outBase)}.md / -rows.csv`);
