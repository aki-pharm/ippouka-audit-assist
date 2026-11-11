/**
 * テストセット用の「架空の施設」の採用品マスタと、行ごとの「選ばれるべき採用品」（正解）を作る。実在の施設とは関係ない。
 *   node scripts/make-rx-facility.cjs
 * 出力：
 *   data/rx-testset/facility.json          架空施設の採用品（data/master.json と同じ項目のうち、照合に使うもの）
 *   data/rx-testset/expected-adopted.csv   1 行＝処方の 1 行。正解の採用品（product_key）／採用なし／メーカー未確定、狙い
 *
 * 正解は下の表で人が決める（アプリの照合を動かして決めてはいけない）。
 * 製品の鍵（product_key）は data/parent/parent-master.json の product_key（このブランチには maker-index.json が無いため）。
 * maker-select を入れると drug_key（成分・規格・剤形）でも同じ薬を指せるが、ここでは使わない。
 * 一般名（generic_name）は data/master.json、無ければ data/parent/naifuku-tablets-20261101.csv から YJ コードで引く。
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "data/rx-testset");

// ---------- 架空施設の決め方 ----------
// 既定：処方箋に書かれた製品（rows.csv の product）がそのまま採用品。下の表は既定と違うものだけ。
// to：処方箋の名前 → 選ばれるべき採用品。case：狙い。alias：採用品の別名（aliases）にこの処方名を入れる（アプリのマスタにある仕組み）
const RULES = {
  // 先発名で処方 → 後発品を採用。別名あり／なし で、アプリが辿れるかを見る
  "ノルバスク錠5mg": { to: "アムロジピン錠5mg「サワイ」", case: "brand_to_generic", alias: true },
  "パリエット錠10mg": { to: "ラベプラゾールNa錠10mg「オーハラ」", case: "brand_to_generic", alias: true },
  "ラシックス錠20mg": { to: "フロセミド錠20mg「NP」", case: "brand_to_generic", alias: true },
  "メトグルコ錠500mg": { to: "メトホルミン塩酸塩錠500mgMT「トーワ」", case: "brand_to_generic", alias: true },
  "リピトール錠10mg": { to: "アトルバスタチン錠10mg「サワイ」", case: "brand_to_generic_noalias" },
  "ムコスタ錠100mg": { to: "レバミピド錠100mg「サワイ」", case: "brand_to_generic_noalias" },
  "マグミット錠330mg": { to: "酸化マグネシウム錠330mg「ヨシダ」", case: "brand_to_generic_noalias" },
  "ガスモチン錠5mg": { to: "モサプリドクエン酸塩錠5mg「AA」", case: "brand_to_generic_noalias" },
  "アーチスト錠10mg": { to: "カルベジロール錠10mg「トーワ」", case: "brand_to_generic_noalias" },
  "アルダクトンA錠25mg": { to: "スピロノラクトン錠25mg「トーワ」", case: "brand_to_generic_noalias" },
  // 処方箋のメーカーと採用のメーカーが違う（同じ剤形）
  "ロスバスタチン錠2.5mg「サワイ」": { to: "ロスバスタチン錠2.5mg「DSEP」", case: "maker_diff" },
  "ロサルタンカリウム錠50mg「サワイ」": { to: "ロサルタンカリウム錠50mg「JG」", case: "maker_diff" },
  "ニフェジピンL錠10mg「サワイ」": { to: "ニフェジピンL錠10mg「トーワ」", case: "maker_diff release" },
  "ドネペジル塩酸塩OD錠5mg「サワイ」": { to: "ドネペジル塩酸塩OD錠5mg「トーワ」", case: "maker_diff od_plain" },
  "ブロチゾラムOD錠0.25mg「サワイ」": { to: "ブロチゾラムOD錠0.25mg「JG」", case: "maker_diff od_plain" },
  // 【般】：OD とふつうの錠、CR と L が両方採用されている成分
  "【般】アムロジピン錠5mg": { to: "アムロジピン錠5mg「サワイ」", case: "general_name od_plain" },
  "【般】アムロジピン口腔内崩壊錠5mg": { to: "アムロジピンOD錠5mg「サワイ」", case: "general_name od_plain" },
  "【般】ニフェジピン徐放錠20mg": { to: "ニフェジピンCR錠20mg「サワイ」", case: "general_name release" },
  "【般】ニフェジピン徐放錠10mg": { to: "ニフェジピンL錠10mg「トーワ」", case: "general_name release" },
  // 採用なし（施設のマスタに無い）
  "ベタニス錠50mg": { to: "採用なし", case: "not_adopted" },
  "ジゴシン錠0.125mg": { to: "採用なし", case: "not_adopted" },
  "ドンペリドン錠10mg「サワイ」": { to: "採用なし", case: "not_adopted" },
  "バファリン配合錠A81": { to: "採用なし", case: "not_adopted" },
  "メチコバール錠250μg": { to: "採用なし", case: "not_adopted strength" },
  // 採用中止（マスタに adopted:false で残っている）→ 採用なし
  "ロキソプロフェンNa錠60mg「サワイ」": { to: "採用なし", case: "discontinued" },
  "リオナ錠250mg": { to: "採用なし", case: "discontinued" },
  // 今のメーカーが決まっていない（maker_state）→ メーカー未確定
  "ロスバスタチン錠5mg「DSEP」": { to: "メーカー未確定", product: "ロスバスタチン錠5mg「DSEP」", case: "maker_unknown" },
  "【般】ロスバスタチン錠5mg": { to: "メーカー未確定", product: "ロスバスタチン錠5mg「DSEP」", case: "maker_unknown general_name" },
  "ファモチジン錠20mg「トーワ」": { to: "メーカー未確定", product: "ファモチジン錠20mg「トーワ」", case: "maker_unknown" },
};
// 正解には出てこないが、紛らわしさを作るために採用しておく製品
const EXTRA_ADOPTED = ["ユニシア配合錠LD", "ドネペジル塩酸塩錠5mg「トーワ」", "ブロチゾラム錠0.25mg「サワイ」", "アムロジピン錠2.5mg「サワイ」"];
const DISCONTINUED = ["ロキソプロフェンNa錠60mg「サワイ」", "リオナ錠250mg"];
const MAKER_STATE = { "ロスバスタチン錠5mg「DSEP」": "未選択", "ファモチジン錠20mg「トーワ」": "記憶ベース（両方使用）" };
// 狙いを自動で足す：【般】、OD/ふつう・CR/L が施設に両方あるもの、配合錠、カプセル

// ---------- 組み立て ----------
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 1);
}
const csvCell = (v) => { const s = v == null ? "" : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

const master = JSON.parse(fs.readFileSync(path.join(ROOT, "data/master.json"), "utf8"));
const parent = JSON.parse(fs.readFileSync(path.join(ROOT, "data/parent/parent-master.json"), "utf8")).products;
const byName = new Map(parent.map((p) => [p.brand_name, p]));
const [nh, ...nr] = parseCsv(fs.readFileSync(path.join(ROOT, "data/parent/naifuku-tablets-20261101.csv"), "utf8"));
const genericByYj = new Map(nr.map((r) => [r[nh.indexOf("yj_code")], r[nh.indexOf("generic_name")]]));

function productRecord(name) {
  const m = master.find((t) => t.brand_name === name);
  const p = byName.get(name);
  if (!m && !p) throw new Error(`製品が親マスタにも data/master.json にも無い: ${name}`);
  // YJ コードで引く。一覧に無い製品は先頭 7 桁（成分）が同じ製品の一般名
  const byPrefix = (yj) => { for (const [k, v] of genericByYj) if (k.slice(0, 7) === yj.slice(0, 7)) return v; return null; };
  const yj = p?.yj_code || p?.group || "";
  const generic = m?.generic_name ?? (yj ? genericByYj.get(yj) ?? byPrefix(yj) : null);
  if (!generic) throw new Error(`一般名が引けない: ${name}`);
  return {
    id: p?.product_key ?? name,
    product_key: p?.product_key ?? null,
    yj_code: p?.yj_code ?? null,
    brand_name: name,
    generic_name: generic,
    strength: p?.strength ?? m.strength,
    maker: p?.maker ?? m?.maker ?? null,
    dosage_form: /カプセル/.test(name) ? "capsule" : "tablet",
    adopted: true,
    maker_state: null,
    aliases: [],
  };
}

const [rh, ...rr] = parseCsv(fs.readFileSync(path.join(OUT, "rows.csv"), "utf8"));
const rows = rr.map((r) => Object.fromEntries(rh.map((h, i) => [h, r[i]])));
const used = new Set(Object.keys(RULES));

const facility = new Map();
const add = (name) => { if (!facility.has(name)) facility.set(name, productRecord(name)); return facility.get(name); };
const expectedRows = [];
for (const r of rows) {
  const rule = RULES[r.name_as_written];
  let expected, pendingProduct = "", cases = [];
  if (rule) {
    cases = rule.case.split(" ");
    if (rule.to === "採用なし") {
      expected = "採用なし";
      if (DISCONTINUED.includes(r.name_as_written)) { const f = add(r.name_as_written); f.adopted = false; }
    } else if (rule.to === "メーカー未確定") {
      expected = "メーカー未確定";
      const f = add(rule.product);
      f.maker_state = MAKER_STATE[rule.product];
      pendingProduct = f.id;
    } else {
      const f = add(rule.to);
      if (rule.alias && !f.aliases.includes(r.name_as_written)) f.aliases.push(r.name_as_written);
      expected = f.id;
    }
  } else {
    expected = add(r.product).id;
    // 書かれた名前（接頭辞を除く）が採用品の名前と同じなら exact。【般】は下で general_name を足す
    cases = r.name_as_written.replace(/^\((K|Ca|Na)\)/, "") === r.product ? ["exact"] : [];
  }
  if (r.name_as_written.startsWith("【般】") && !cases.includes("general_name")) cases.push("general_name");
  if (/配合/.test(r.name_as_written)) cases.push("combo");
  expectedRows.push({ rx: r.rx, rp: r.rp, name_as_written: r.name_as_written, expected, pending_product: pendingProduct, cases: [...new Set(cases)].join(" ") });
}
for (const n of EXTRA_ADOPTED) add(n);
for (const k of used) if (!rows.some((r) => r.name_as_written === k)) throw new Error(`表にあるが処方に無い名前: ${k}`);

const products = [...facility.values()].sort((a, b) => a.brand_name.localeCompare(b.brand_name, "ja"));
fs.writeFileSync(path.join(OUT, "facility.json"), JSON.stringify({
  _説明: [
    "架空の施設の採用品マスタ（読み取りテストの段階 2「採用品の選択」用）。実在の施設の採用品ではない。node scripts/make-rx-facility.cjs で作る",
    "項目は data/master.json（アプリのマスタ）のうち照合に使うもの＋ maker_state（feature/maker-select の今のメーカーの状態）。id は親マスタの product_key",
    "adopted:false は採用中止でマスタに残っているもの。maker_state が 未選択／記憶ベース（両方使用） はメーカー未確定",
  ],
  facility: "架空施設（テスト用）",
  products,
}, null, 1) + "\n");
const head = ["rx", "rp", "name_as_written", "expected", "pending_product", "cases"];
fs.writeFileSync(path.join(OUT, "expected-adopted.csv"), [head.join(","), ...expectedRows.map((e) => head.map((h) => csvCell(e[h])).join(","))].join("\n") + "\n");

const count = (pred) => expectedRows.filter(pred).length;
const caseCount = {};
for (const e of expectedRows) for (const c of e.cases.split(" ")) caseCount[c] = (caseCount[c] ?? 0) + 1;
console.log(`採用品 ${products.length}（採用中止 ${products.filter((p) => !p.adopted).length}、メーカー未確定 ${products.filter((p) => p.maker_state).length}、別名あり ${products.filter((p) => p.aliases.length).length}）`);
console.log(`行 ${expectedRows.length}：製品 ${count((e) => !["採用なし", "メーカー未確定"].includes(e.expected))}・採用なし ${count((e) => e.expected === "採用なし")}・メーカー未確定 ${count((e) => e.expected === "メーカー未確定")}`);
console.log("狙い:", Object.entries(caseCount).sort().map(([k, v]) => `${k} ${v}`).join("、"));
