/**
 * 処方箋の読み取り結果を、架空処方箋テストセットの正解と突き合わせて項目別に採点する（人の目視なし）。
 *
 *   node scripts/eval/score-rx.cjs --results <読み取り結果のフォルダ> [--out reports/score-rx] [--meta <撮影の記録.csv>]
 *                                  [--expected data/rx-testset/expected] [--rows data/rx-testset/rows.csv]
 *
 * 入力
 *   --results：1 画像（または 1 処方の複数ページ）につき 1 つの JSON。中身は /api/read-rx の応答 {result, usage}、
 *              または result だけ（RxReadResult）。scripts/read-rx-batch.ts の出力そのまま。{error} だけのものは「読み取り失敗」
 *   ファイル名の決まり（docs/rx-testset.md）：<処方>__<撮影者>__<機器>__<条件>[__<回>].json 例 rx07__AKI__iphone__tilt.json
 *              ページごとに保存したもの（rx05-1__…json と rx05-2__…json）は、同じ処方・同じ撮影として 1 つにまとめてから採点する
 *              （items をページ順につなぐ。どれかのページが読めなければ、その撮影は「読み取り失敗」に数え、読めたページの行だけで採点）。
 *              決まりに合わない部分は「-」として数える。壊れた JSON・空のファイル・items の中の null の行で止まらない（失敗・無視として数える）
 *   --meta（任意）：列 key,photographer,device,condition。key はファイル名から .json を除いたもの。ファイル名より優先
 *
 * 出力
 *   <out>.md         項目別・狙い別・条件別・撮影者別・機器別の正解率、間違いの例
 *   <out>-rows.csv   正解の 1 行ごとの判定（画像 × 行）。どの項目が違ったか、読んだ値
 *   <out>-groups.csv 条件・撮影者・機器・処方ごとの集計
 *
 * 決まり
 * - 行の対応づけ：順番に頼らない。薬品名の近さ（2 文字ずつの一致率）を主に、規格・Rp 番号・朝昼夕の一致を足した点数で、
 *   合計が最大になる組み合わせを選ぶ（全探索の動的計画法）。名前の近さが 0.5 未満の組は対応させない（Rp が同じなら 0.3 以上）。
 *   対応する読み取り行が無い正解行＝「抜け」、対応する正解行が無い読み取り行＝「余分」
 * - 正解率の分母は正解の行数（抜けはすべての項目で不正解に数える）。対応できた行だけの正解率も別に出す
 * - 採点はマスタとの照合（lib/master.ts の normalize）より厳しくする。採点の正規化 strictText は NFKC・空白除去・μ と ㎎ の統一・小文字だけで、
 *   **括弧の中は消さない**（「(OD)」「（0.5mg）」「（24時間持続）」で薬が変わるため）。lib/master.ts の写しは行の対応づけにだけ使う
 * - 薬品名：strictText で比べる。メーカー名「」と【般】も比べる。行頭の (K)(Ca)(Na) だけは別に扱い、
 *   読み取りに接頭辞が無ければ不問（意味は薬品名に含まれる）、有れば正解と同じ接頭辞のときだけ正しい（(Na) と (K) の取り違えは誤り）
 * - 「名前（基幹）」：メーカー名「」と行頭の【般】(K)(Ca)(Na) を除いて strictText で比べる（括弧の中は残す）
 * - 規格：strictText で比べる。配合錠は「配合錠」の後ろの記号（HD・A81 など）が規格（11/11 AKI の判断）。正解が null のときは読み取りも null・空のときだけ正しい
 * - 数（1回量・回数・1日量・朝昼夕・日数）：数か、数字だけの文字列（"2"）だけを数として比べる。true・"2錠" などは誤り。正解が null なら null・空だけ正しい
 * - 眠前：1日量 −（朝＋昼＋夕）を眠前の錠数とみなして比べる（11/11 AKI：1日量は眠前を含む。アプリの表は朝昼夕だけで、眠前は扱えない）
 * - 全量：読み取りの 1日量 × 日数 を、印字の全量と比べる
 * - 「行が全部正しい」：薬品名・規格・朝昼夕の 3 つ・1日量（＝眠前も）・日数・別包・□コ・括弧の補足（name_note）がすべて正しい
 */
const fs = require("fs");
const path = require("path");
const { parseCsv, csvCell, mdTable } = require("./lib.cjs");

const ROOT = path.resolve(__dirname, "../..");

// ---------- 引数 ----------
function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

// ---------- lib/master.ts と同じ正規化（変えたらこちらも。下の checkDrift で食い違いを知らせる） ----------
function normalize(s) {
  return String(s ?? "")
    .normalize("NFKC")
    .replace(/[\s　]/g, "")
    .replace(/[µμ]/g, "μ")
    .replace(/㎎/g, "mg")
    .replace(/[（(][^）)]*[）)]/g, "")
    .toLowerCase();
}
const stripMaker = (s) => String(s ?? "").replace(/[「『][^」』]*[」』]/g, "");
const stripPrefix = (s) => s.replace(/^(【般】|\[般\]|般|\(k\)|\(ca\)|\(na\))/i, "");

// ---------- 採点用の厳しい比べ方（括弧の中を消さない） ----------
function strictText(s) {
  return String(s ?? "")
    .normalize("NFKC")
    .replace(/[\s　]/g, "")
    .replace(/[µμ]/g, "μ")
    .replace(/㎎/g, "mg")
    .toLowerCase();
}
const PREFIX_RE = /^\((k|ca|na)\)/; // strictText の後（小文字・半角括弧）
function splitPrefix(s) {
  const t = strictText(s);
  const m = t.match(PREFIX_RE);
  return m ? { prefix: m[1], body: t.slice(m[0].length) } : { prefix: "", body: t };
}
/** 薬品名：本体が同じで、読み取りの接頭辞が「無い」か「正解と同じ」 */
function nameOk(pred, exp) {
  if (typeof pred !== "string") return false;
  const p = splitPrefix(pred);
  const e = splitPrefix(exp);
  return p.body === e.body && (p.prefix === "" || p.prefix === e.prefix);
}
/** 基幹名：メーカー名「」と行頭の【般】(K)(Ca)(Na) を除く。括弧の中（(OD) など）は残す */
const coreName = (s) => strictText(stripMaker(s)).replace(/^(?:【般】|\((?:k|ca|na)\))+/, "");

/** lib/master.ts の normalize・stripMaker・stripPrefix の本文が、ここに写したものと同じかを確かめる */
function checkDrift() {
  const file = path.join(ROOT, "lib/master.ts");
  if (!fs.existsSync(file)) return "lib/master.ts が見つからない";
  const src = fs.readFileSync(file, "utf8");
  const squash = (t) => t.replace(/\/\/.*$/gm, "").replace(/[ \t\r\n]+/g, ""); // \s は全角空白も消すので使わない
  const expect = {
    normalize: String.raw`returns.normalize("NFKC").replace(/[\s　]/g,"").replace(/[µμ]/g,"μ").replace(/㎎/g,"mg").replace(/[（(][^）)]*[）)]/g,"").toLowerCase();`,
    stripMaker: String.raw`returns.replace(/[「『][^」』]*[」』]/g,"");`,
    stripPrefix: String.raw`returns.replace(/^(【般】|\[般\]|般|\(k\)|\(ca\)|\(na\))/i,"");`,
  };
  const bad = [];
  for (const [fn, body] of Object.entries(expect)) {
    const m = src.match(new RegExp(`export function ${fn}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`));
    if (!m || squash(m[1]) !== body) bad.push(fn);
  }
  return bad.length ? `lib/master.ts の ${bad.join("・")} が採点側の写しと違う。scripts/eval/score-rx.cjs を合わせること` : null;
}

// ---------- 比べ方 ----------
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
/** 数か、数字だけの文字列なら数に。それ以外（true・"2錠"・オブジェクトなど）は undefined */
function toNum(v) {
  if (isNum(v)) return v;
  if (typeof v === "string") {
    const t = v.normalize("NFKC").trim();
    if (/^\d+(?:\.\d+)?$/.test(t)) return Number(t);
  }
  return undefined;
}
const isEmpty = (v) => v == null || (typeof v === "string" && strictText(v) === "");
const numEq = (a, b) => (b == null ? isEmpty(a) : toNum(a) === b);
const textEq = (a, b) => typeof a === "string" && strictText(a) === strictText(b);
const emptyish = isEmpty;

function bigrams(s) {
  const out = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}
/** 2 文字ずつの一致率（Dice 係数）。0〜1 */
function dice(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) ?? 0);
  return (2 * inter) / (a.length - 1 + b.length - 1);
}

function strengthOk(pred, exp) {
  if (exp == null) return isEmpty(pred);
  return textEq(pred, exp);
}

const pt = (it, k) => it?.per_timing?.[k];
/** 眠前の錠数＝1日量 −（朝＋昼＋夕）。どれかが数でなければ undefined */
function bedtimeOf(it) {
  const d = toNum(it?.dose_per_day);
  const t = ["morning", "noon", "evening"].map((k) => toNum(pt(it, k)));
  if (d === undefined || t.some((x) => x === undefined)) return undefined;
  return d - t[0] - t[1] - t[2];
}

/** 1 組の判定。p が null なら抜け（全部 false） */
function judgeRow(e, p, total) {
  if (!p) return Object.fromEntries(FIELDS.map((f) => [f, false]));
  const r = {
    name: nameOk(p.name_as_written, e.name_as_written),
    name_core: typeof p.name_as_written === "string" && coreName(p.name_as_written) === coreName(e.name_as_written),
    strength: strengthOk(p.strength, e.strength),
    dosage_form: p.dosage_form === e.dosage_form,
    dose_per_time: numEq(p.dose_per_time, e.dose_per_time),
    times_per_day: numEq(p.times_per_day, e.times_per_day),
    dose_per_day: numEq(p.dose_per_day, e.dose_per_day),
    morning: numEq(pt(p, "morning"), pt(e, "morning")),
    noon: numEq(pt(p, "noon"), pt(e, "noon")),
    evening: numEq(pt(p, "evening"), pt(e, "evening")),
    days: numEq(p.days, e.days),
    bedtime: bedtimeOf(p) !== undefined && bedtimeOf(p) === bedtimeOf(e),
    total: toNum(p.dose_per_day) !== undefined && toNum(p.days) !== undefined && toNum(p.dose_per_day) * toNum(p.days) === total,
    pack: p.pack_instruction === e.pack_instruction,
    mark: p.manual_fill_mark === e.manual_fill_mark,
    name_note: emptyish(p.name_note) ? emptyish(e.name_note) : textEq(p.name_note, e.name_note),
  };
  r.per_timing = r.morning && r.noon && r.evening;
  r.row_ok = r.name && r.strength && r.per_timing && r.dose_per_day && r.days && r.pack && r.mark && r.name_note;
  return r;
}

const FIELDS = ["name", "name_core", "strength", "dosage_form", "dose_per_time", "times_per_day", "dose_per_day", "morning", "noon", "evening", "per_timing", "bedtime", "days", "total", "pack", "mark", "name_note", "row_ok"];
const FIELD_LABEL = {
  name: "薬品名（メーカー・【般】込み）",
  name_core: "薬品名（基幹）",
  strength: "規格",
  dosage_form: "剤形",
  dose_per_time: "1回量",
  times_per_day: "1日の回数",
  dose_per_day: "1日量",
  morning: "朝",
  noon: "昼",
  evening: "夕",
  per_timing: "朝昼夕すべて",
  bedtime: "眠前（1日量−朝昼夕）",
  days: "日数",
  total: "全量（1日量×日数）",
  pack: "別包（pack_instruction）",
  mark: "□コ（manual_fill_mark）",
  name_note: "括弧の補足（name_note）",
  row_ok: "行が全部正しい",
};
const SHORT = ["name", "strength", "per_timing", "dose_per_day", "days", "pack", "mark", "name_note", "row_ok"];

// 狙い → その狙いで特に見る項目
const TRICK_FIELDS = {
  manual_mark: ["mark"],
  separate_pack: ["pack"],
  nonuniform_dosing: ["per_timing", "dose_per_day"],
  general_name: ["name"],
  prefix: ["name"],
  two_per_dose: ["per_timing", "dose_per_day"],
  odd_days: ["days", "total"],
  page2: ["name"],
  name_note: ["name", "name_note"],
  capsule: ["dosage_form"],
  bedtime: ["bedtime", "dose_per_day"],
  lookalike: ["name"],
  multi_strength: ["name", "strength"],
  brand_generic_stock: ["name"],
  combo: ["name", "strength"],
  unit_meq: ["strength"],
};
const TRICK_LABEL = {
  manual_mark: "□コ（手巻き）",
  separate_pack: "別包（ヒート包装）",
  nonuniform_dosing: "1-0-2-0-0-0 で投与",
  general_name: "【般】一般名",
  prefix: "(K)(Ca)(Na) の接頭辞",
  two_per_dose: "1回2錠以上",
  odd_days: "半端な日数",
  page2: "2ページ目の行",
  name_note: "括弧の補足",
  capsule: "カプセル",
  bedtime: "就寝前を含む",
  lookalike: "似た名前",
  multi_strength: "同じ薬の別規格",
  brand_generic_stock: "先発名で印字",
  combo: "配合錠（規格は HD などの記号）",
  unit_meq: "単位 mEq",
};

// ---------- 行の対応づけ ----------
function pairScore(e, p) {
  if (typeof p.name_as_written !== "string" || !p.name_as_written) return null;
  const ne = normalize(e.name_as_written);
  const np = normalize(p.name_as_written);
  let sim = dice(ne, np);
  if (coreName(e.name_as_written) === coreName(p.name_as_written)) sim = Math.max(sim, 0.9);
  const rpSame = String(p.rp ?? "").replace(/^0+/, "") === String(e.rp).replace(/^0+/, "");
  if (!(sim >= 0.5 || (rpSame && sim >= 0.3))) return null;
  let s = sim;
  if (strengthOk(p.strength, e.strength)) s += 0.3;
  if (rpSame) s += 0.2;
  if (["morning", "noon", "evening"].every((k) => pt(p, k) === pt(e, k))) s += 0.1;
  return s;
}

/** 合計点が最大の 1 対 1 の対応。返り値：exp の添字 → pred の添字（無ければ -1） */
function align(exp, pred) {
  const E = exp.length;
  const P = pred.length;
  const score = exp.map((e) => pred.map((p) => pairScore(e, p)));
  const result = new Array(E).fill(-1);
  if (E > 16) {
    // 大きすぎるときは点の高い順に貪欲に
    const pairs = [];
    for (let i = 0; i < E; i++) for (let j = 0; j < P; j++) if (score[i][j] != null) pairs.push([score[i][j], i, j]);
    pairs.sort((a, b) => b[0] - a[0]);
    const usedP = new Set();
    for (const [, i, j] of pairs) if (result[i] < 0 && !usedP.has(j)) { result[i] = j; usedP.add(j); }
    return result;
  }
  // dp[j][mask]：読み取り行 0..j-1 まで見て、正解行の使用状況が mask のときの最大点
  const M = 1 << E;
  const dp = Array.from({ length: P + 1 }, () => new Float64Array(M).fill(-Infinity));
  const choice = Array.from({ length: P + 1 }, () => new Int16Array(M).fill(-1));
  dp[0][0] = 0;
  for (let j = 0; j < P; j++) {
    for (let mask = 0; mask < M; mask++) {
      const cur = dp[j][mask];
      if (cur === -Infinity) continue;
      if (cur > dp[j + 1][mask]) { dp[j + 1][mask] = cur; choice[j + 1][mask] = -1; } // 余分として飛ばす
      for (let i = 0; i < E; i++) {
        if (mask & (1 << i) || score[i][j] == null) continue;
        const nm = mask | (1 << i);
        const v = cur + score[i][j];
        if (v > dp[j + 1][nm]) { dp[j + 1][nm] = v; choice[j + 1][nm] = i; }
      }
    }
  }
  let best = 0;
  for (let mask = 0; mask < M; mask++) if (dp[P][mask] > dp[P][best]) best = mask;
  for (let j = P, mask = best; j > 0; j--) {
    const i = choice[j][mask];
    if (i >= 0) { result[i] = j - 1; mask &= ~(1 << i); }
  }
  return result;
}

// ---------- ファイル名・撮影の記録 ----------
function parseKey(key) {
  const parts = key.split("__");
  const rx = (parts[0] ?? "").replace(/-\d+$/, "");
  return { rx, photographer: parts[1] || "-", device: parts[2] || "-", condition: parts[3] || "-", take: parts[4] || "" };
}

function loadMeta(file) {
  const out = new Map();
  if (!file) return out;
  const rows = parseCsv(fs.readFileSync(file, "utf8")).filter((r) => r.some((c) => c.trim() !== ""));
  const head = rows.shift().map((h) => h.trim());
  for (const r of rows) {
    const o = Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()]));
    if (o.key) out.set(o.key.replace(/\.json$/, ""), o);
  }
  return out;
}

// ---------- 集計 ----------
function newAgg() {
  return { images: 0, failed: 0, perfect: 0, rows: 0, missing: 0, extra: 0, matched: 0, ok: Object.fromEntries(FIELDS.map((f) => [f, 0])), okMatched: Object.fromEntries(FIELDS.map((f) => [f, 0])), aod: 0, aodOk: 0, inTok: 0, outTok: 0, cost: 0, costN: 0 };
}
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : "-");
const frac = (a, b) => (b ? `${a}/${b}（${((100 * a) / b).toFixed(1)}%）` : "-");

/**
 * 結果のファイル 1 つを読む。返り値：{ res（items が配列のときだけ。null の行などは取り除く）, usage, cost, parseError }
 * 壊れた JSON・空のファイルでも止めない
 */
function loadResult(file) {
  let raw;
  try {
    const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""); // メモ帳などの BOM を取る
    raw = JSON.parse(text);
  } catch {
    return { res: null, usage: null, cost: null, parseError: true };
  }
  const r = raw && typeof raw === "object" && Array.isArray(raw.items) ? raw : raw && typeof raw === "object" ? raw.result : null;
  const ok = r && typeof r === "object" && Array.isArray(r.items);
  const res = ok ? { ...r, items: r.items.filter((x) => x && typeof x === "object" && !Array.isArray(x)) } : null;
  const usage = raw && typeof raw === "object" && raw.usage && typeof raw.usage === "object" ? raw.usage : null;
  const cost = raw && typeof raw === "object" && isNum(raw.cost_usd) ? raw.cost_usd : null;
  return { res, usage, cost, parseError: false };
}

function sumUsage(loaded) {
  const us = loaded.map((l) => l.usage).filter(Boolean);
  if (!us.length) return null;
  return {
    input: us.reduce((a, u) => a + (toNum(u.input ?? u.input_tokens) ?? 0), 0),
    output: us.reduce((a, u) => a + (toNum(u.output ?? u.output_tokens) ?? 0), 0),
  };
}

function main() {
  const resultsDir = arg("--results");
  if (!resultsDir) {
    console.error("使い方: node scripts/eval/score-rx.cjs --results <読み取り結果のフォルダ> [--out reports/score-rx] [--meta <csv>]");
    process.exit(1);
  }
  const expDir = path.resolve(arg("--expected", path.join(ROOT, "data/rx-testset/expected")));
  const rowsCsv = path.resolve(arg("--rows", path.join(ROOT, "data/rx-testset/rows.csv")));
  const outBase = path.resolve(arg("--out", path.join(ROOT, "reports/score-rx")));
  const meta = loadMeta(arg("--meta"));

  // 正解
  const expected = new Map();
  for (const f of fs.readdirSync(expDir).filter((f) => f.endsWith(".expected.json")).sort()) {
    expected.set(f.replace(/\.expected\.json$/, ""), JSON.parse(fs.readFileSync(path.join(expDir, f), "utf8")));
  }
  const rowMeta = new Map(); // "rx07|03" → {tricks, total, page}
  const csv = parseCsv(fs.readFileSync(rowsCsv, "utf8")).filter((r) => r.length > 1);
  const head = csv.shift();
  for (const r of csv) {
    const o = Object.fromEntries(head.map((h, i) => [h, r[i]]));
    rowMeta.set(`${o.rx}|${o.rp}`, { tricks: o.tricks ? o.tricks.split(" ") : [], total: Number(o.total), page: Number(o.page) });
  }

  const files = fs.readdirSync(resultsDir).filter((f) => f.endsWith(".json")).sort();
  if (!files.length) {
    console.error(`読み取り結果が無い: ${resultsDir}`);
    process.exit(1);
  }

  const overall = newAgg();
  const groups = { condition: new Map(), photographer: new Map(), device: new Map(), rx: new Map() };
  const tricks = new Map();
  const rowLines = [];
  const examples = [];
  const extras = [];
  const skipped = [];
  const fieldWrong = Object.fromEntries(FIELDS.map((f) => [f, 0]));
  const flag = { mark: { tp: 0, fp: 0, fn: 0, tn: 0 }, pack: { tp: 0, fp: 0, fn: 0, tn: 0 } };

  // ページごとのファイル（rx05-1__… と rx05-2__…）は同じ撮影として 1 つにまとめる
  const byKey = new Map();
  for (const f of files) {
    const stem = f.replace(/\.json$/, "");
    const [head, ...rest] = stem.split("__");
    const pm = head.match(/^(.*?)-(\d+)$/);
    const key = [pm ? pm[1] : head, ...rest].join("__");
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push({ file: f, page: pm ? Number(pm[2]) : 0 });
  }
  let mergedKeys = 0;
  let parseErrors = 0;
  // まとめたファイル（ページ番号なし）とページごとのファイルが同じ撮影名で両方あれば、まとめたファイルだけを使う（二重に数えない）
  const ignoredPages = [];
  for (const [key, parts] of byKey) {
    if (parts.some((x) => x.page === 0) && parts.some((x) => x.page > 0)) {
      ignoredPages.push(...parts.filter((x) => x.page > 0).map((x) => x.file));
      byKey.set(key, parts.filter((x) => x.page === 0));
    }
  }

  for (const [key, parts] of byKey) {
    const info = { ...parseKey(key), ...(meta.get(key) ?? {}) };
    const exp = expected.get(info.rx);
    if (!exp) { skipped.push(`${parts.map((x) => x.file).join("+")}（正解が無い処方: ${info.rx}）`); continue; }
    if (parts.length > 1) mergedKeys++;
    const loaded = parts.sort((a, b) => a.page - b.page).map((x) => loadResult(path.join(resultsDir, x.file)));
    parseErrors += loaded.filter((l) => l.parseError).length;
    const okParts = loaded.filter((l) => l.res);
    const failed = okParts.length < loaded.length;
    const pred = okParts.flatMap((l) => l.res.items);
    const res = okParts.length
      ? { items: pred, all_one_dose: okParts.some((l) => l.res.all_one_dose === true) ? true : okParts.every((l) => l.res.all_one_dose === false) ? false : null, include_all_note: okParts.map((l) => l.res.include_all_note).find((v) => !isEmpty(v)) ?? null }
      : null;
    const raw = { usage: sumUsage(loaded), cost_usd: loaded.some((l) => l.cost != null) ? loaded.reduce((a, l) => a + (l.cost ?? 0), 0) : null };
    const map = align(exp.items, pred);
    const usedP = new Set(map.filter((j) => j >= 0));

    const aggs = [overall, ...["condition", "photographer", "device", "rx"].map((g) => {
      const k = info[g] || "-";
      if (!groups[g].has(k)) groups[g].set(k, newAgg());
      return groups[g].get(k);
    })];
    let imagePerfect = !failed;
    const imgRows = [];
    exp.items.forEach((e, i) => {
      const p = map[i] >= 0 ? pred[map[i]] : null;
      const m = rowMeta.get(`${info.rx}|${e.rp}`) ?? { tricks: [], total: e.dose_per_day * e.days, page: 1 };
      const j = judgeRow(e, p, m.total);
      if (!j.row_ok) imagePerfect = false;
      imgRows.push({ e, p, j, m });
      for (const fl of ["mark", "pack"]) {
        const ePos = fl === "mark" ? e.manual_fill_mark : e.pack_instruction === "exclude";
        const pPos = p ? (fl === "mark" ? p.manual_fill_mark === true : p.pack_instruction === "exclude") : false;
        flag[fl][ePos ? (pPos ? "tp" : "fn") : pPos ? "fp" : "tn"]++;
      }
      for (const t of m.tricks) {
        if (!tricks.has(t)) tricks.set(t, { rows: 0, missing: 0, ok: Object.fromEntries(FIELDS.map((x) => [x, 0])) });
        const T = tricks.get(t);
        T.rows++;
        if (!p) T.missing++;
        for (const x of FIELDS) if (j[x]) T.ok[x]++;
      }
      for (const x of FIELDS) if (!j[x]) fieldWrong[x]++;
      if (p && !j.row_ok && examples.length < 60) {
        const wrong = SHORT.filter((x) => x !== "row_ok" && !j[x]);
        examples.push([key, e.rp, e.name_as_written, wrong.map((x) => FIELD_LABEL[x]).join("・"), describeDiff(e, p, wrong)]);
      }
      rowLines.push([key, info.rx, info.photographer, info.device, info.condition, e.rp, m.page, e.name_as_written, p ? p.rp : "", p ? p.name_as_written : "（抜け）", m.tricks.join(" "), ...FIELDS.map((x) => (j[x] ? 1 : 0)),
        p ? p.strength : "", p ? `${pt(p, "morning")}-${pt(p, "noon")}-${pt(p, "evening")}` : "", p ? p.days : "", p ? p.pack_instruction : "", p ? p.manual_fill_mark : ""]);
    });
    pred.forEach((p, jdx) => { if (!usedP.has(jdx)) { extras.push([key, p.rp, p.name_as_written]); imagePerfect = false; } });
    const nExtra = pred.length - usedP.size;
    const aodOk = !!res && !failed && res.all_one_dose === exp.all_one_dose && (emptyish(res.include_all_note) ? emptyish(exp.include_all_note) : textEq(res.include_all_note, exp.include_all_note));
    if (!aodOk) imagePerfect = false;
    const usage = raw?.usage;
    for (const a of aggs) {
      a.images++;
      if (failed) a.failed++;
      if (imagePerfect) a.perfect++;
      a.rows += exp.items.length;
      a.missing += exp.items.length - usedP.size;
      a.extra += nExtra;
      a.matched += usedP.size;
      for (const r of imgRows) for (const x of FIELDS) if (r.j[x]) { a.ok[x]++; if (r.p) a.okMatched[x]++; }
      a.aod++;
      if (aodOk) a.aodOk++;
      if (usage) { a.inTok += usage.input ?? usage.input_tokens ?? 0; a.outTok += usage.output ?? usage.output_tokens ?? 0; }
      if (raw?.cost_usd != null) { a.cost += raw.cost_usd; a.costN++; }
    }
  }

  // ---------- 書き出し ----------
  fs.mkdirSync(path.dirname(outBase), { recursive: true });
  const rowHead = ["key", "rx", "photographer", "device", "condition", "rp", "page", "expected_name", "pred_rp", "pred_name", "tricks", ...FIELDS, "pred_strength", "pred_per_timing", "pred_days", "pred_pack", "pred_mark"];
  fs.writeFileSync(`${outBase}-rows.csv`, "﻿" + [rowHead, ...rowLines].map((r) => r.map(csvCell).join(",")).join("\n") + "\n");

  const groupHead = ["group", "value", "images", "failed", "images_perfect", "rows", "missing", "extra", ...FIELDS.map((f) => `${f}_acc`), "all_one_dose_acc", "input_tokens", "output_tokens", "cost_usd"];
  const groupLines = [];
  const pushGroup = (g, k, a) => groupLines.push([g, k, a.images, a.failed, a.perfect, a.rows, a.missing, a.extra, ...FIELDS.map((f) => (a.rows ? (a.ok[f] / a.rows).toFixed(4) : "")), a.aod ? (a.aodOk / a.aod).toFixed(4) : "", a.inTok, a.outTok, a.costN ? a.cost.toFixed(4) : ""]);
  pushGroup("all", "all", overall);
  for (const [g, m] of Object.entries(groups)) for (const [k, a] of [...m].sort()) pushGroup(g, k, a);
  fs.writeFileSync(`${outBase}-groups.csv`, "﻿" + [groupHead, ...groupLines].map((r) => r.map(csvCell).join(",")).join("\n") + "\n");

  const md = [];
  const drift = checkDrift();
  md.push("# 処方箋の読み取りの採点（架空処方箋テストセット）", "");
  md.push(`- 読み取り結果：\`${path.relative(ROOT, path.resolve(resultsDir))}\`（${files.length} ファイル、採点 ${overall.images}、読み取り失敗 ${overall.failed}）`);
  md.push(`- 正解：\`${path.relative(ROOT, expDir)}\`（処方 ${expected.size} 件）、行の狙い：\`${path.relative(ROOT, rowsCsv)}\``);
  md.push(`- 作成：${new Date().toISOString()}　\`node scripts/eval/score-rx.cjs\`（決まりはスクリプト先頭）`);
  if (drift) md.push(`- **注意**：${drift}`);
  if (ignoredPages.length) md.push(`- まとめたファイルと同じ撮影名なので使わなかったページごとのファイル：${ignoredPages.length}（${ignoredPages.slice(0, 5).join("、")}${ignoredPages.length > 5 ? " …" : ""}）`);
  if (mergedKeys) md.push(`- ページごとのファイルを 1 つの撮影にまとめた：${mergedKeys}`);
  if (parseErrors) md.push(`- 読めないファイル（壊れた JSON・空）：${parseErrors}（読み取り失敗に数えた）`);
  if (skipped.length) md.push(`- 採点しなかったファイル ${skipped.length}：${skipped.slice(0, 10).join("、")}`);
  md.push("");
  md.push("## 全体", "");
  md.push(mdTable(["項目", "値"], [
    ["正解の行（画像 × 行）", overall.rows],
    ["対応できた行", overall.matched],
    ["抜け（正解にあるが読めていない行）", overall.missing],
    ["余分（正解に無い行）", overall.extra],
    ["全部正しい画像（行・余分なし・一包化の指示）", frac(overall.perfect, overall.images)],
    ["一包化の指示（all_one_dose と「○○も含めて」）", frac(overall.aodOk, overall.aod)],
    ...(overall.inTok ? [["トークン（入力／出力、合計）", `${overall.inTok}／${overall.outTok}`]] : []),
    ...(overall.costN ? [["費用（合計／1 ファイルあたり）", `$${overall.cost.toFixed(4)}／$${(overall.cost / overall.costN).toFixed(4)}`]] : []),
  ]));
  md.push("", "## 項目別の正解率", "", "分母は正解の行数（抜けは不正解）。右の列は対応できた行だけで数えたもの。", "");
  md.push(mdTable(["項目", "正解／正解の行", "対応できた行だけ"], FIELDS.map((f) => [FIELD_LABEL[f], frac(overall.ok[f], overall.rows), pct(overall.okMatched[f], overall.matched)])));
  md.push("", "## □コ と 別包 の取りこぼし・付けすぎ", "", "印のある行が少ないので、正解率だけでなく数で見る。抜けた行は「取りこぼし」に数える。", "");
  md.push(mdTable(["印", "正しく付いた", "取りこぼし（印があるのに無し）", "付けすぎ（印が無いのに有り）", "正しく無し"], [
    ["□コ", flag.mark.tp, flag.mark.fn, flag.mark.fp, flag.mark.tn],
    ["別包", flag.pack.tp, flag.pack.fn, flag.pack.fp, flag.pack.tn],
  ]));
  md.push("", "## 狙い別", "", "1 行が複数の狙いに入る。「見る項目」はその狙いで特に間違えやすい項目。", "");
  md.push(mdTable(["狙い", "行", "抜け", "見る項目の正解率", "行が全部正しい"], [...tricks].sort((a, b) => b[1].rows - a[1].rows).map(([t, T]) => [
    TRICK_LABEL[t] ?? t, T.rows, T.missing, (TRICK_FIELDS[t] ?? []).map((x) => `${FIELD_LABEL[x]} ${pct(T.ok[x], T.rows)}`).join("、"), pct(T.ok.row_ok, T.rows)])));
  const groupTable = (g, title) => {
    const m = groups[g];
    if (!m.size || (m.size === 1 && m.has("-"))) return;
    md.push("", `## ${title}`, "");
    md.push(mdTable([title.replace(/別$/, ""), "画像", "失敗", "全部正しい画像", "抜け", "余分", ...SHORT.map((f) => FIELD_LABEL[f]), ...(overall.costN ? ["費用/画像"] : [])],
      [...m].sort().map(([k, a]) => [k, a.images, a.failed, pct(a.perfect, a.images), a.missing, a.extra, ...SHORT.map((f) => pct(a.ok[f], a.rows)), ...(overall.costN ? [a.costN ? `$${(a.cost / a.costN).toFixed(4)}` : "-"] : [])])));
  };
  groupTable("condition", "撮影条件別");
  groupTable("photographer", "撮影者別");
  groupTable("device", "機器別");
  groupTable("rx", "処方別");
  md.push("", "## 間違いの例（対応できた行のうち、行が全部正しくはないもの。最大 60）", "");
  md.push(examples.length ? mdTable(["ファイル", "Rp", "正解の薬品名", "違った項目", "正解 → 読み取り"], examples) : "なし");
  md.push("", `## 余分な行（最大 30／全 ${extras.length}）`, "");
  md.push(extras.length ? mdTable(["ファイル", "読み取りの Rp", "読み取りの薬品名"], extras.slice(0, 30)) : "なし");
  md.push("");
  fs.writeFileSync(`${outBase}.md`, md.join("\n"));

  console.log(`採点 ${overall.images} 画像（失敗 ${overall.failed}）・正解の行 ${overall.rows}・抜け ${overall.missing}・余分 ${overall.extra}`);
  console.log(SHORT.map((f) => `${FIELD_LABEL[f]} ${pct(overall.ok[f], overall.rows)}`).join("、"));
  console.log(`→ ${path.relative(ROOT, outBase)}.md / -rows.csv / -groups.csv`);
  if (drift) console.warn(`注意: ${drift}`);
}

function describeDiff(e, p, wrong) {
  const show = {
    name: () => `${e.name_as_written} → ${p.name_as_written}`,
    strength: () => `規格 ${e.strength} → ${p.strength}`,
    dose_per_day: () => `1日量 ${e.dose_per_day} → ${p.dose_per_day}`,
    name_note: () => `補足 ${e.name_note} → ${p.name_note}`,
    per_timing: () => `朝昼夕 ${pt(e, "morning")}-${pt(e, "noon")}-${pt(e, "evening")} → ${pt(p, "morning")}-${pt(p, "noon")}-${pt(p, "evening")}`,
    days: () => `日数 ${e.days} → ${p.days}`,
    pack: () => `別包 ${e.pack_instruction} → ${p.pack_instruction}`,
    mark: () => `□コ ${e.manual_fill_mark} → ${p.manual_fill_mark}`,
  };
  return wrong.map((w) => show[w]?.()).filter(Boolean).join("／");
}

if (require.main === module) main();
module.exports = { normalize, strictText, nameOk, coreName, dice, align, judgeRow, parseKey, strengthOk, toNum, bedtimeOf, loadResult, checkDrift };
