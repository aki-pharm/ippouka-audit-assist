/**
 * 親マスタの下書き（data/parent/drafts/claude-sonnet-5-5/*.json、1ファイル＝1品目＝YJコード）をルールで検査する。
 *   node scripts/eval/check-parent.cjs
 * 出力：reports/check-parent.md、reports/check-parent.csv（怪しい順）
 *
 * 検査の単位：品目（ファイル）。各ファイルの products のうち、その品目の product を次の順で選ぶ（「主規格」）：
 *   厚労省リストの販売名と product_name が一致 → 規格（strength、「1錠」「1カプセル」を除く）が一致 → products[0]
 * ルール2（同じ添付文書内の食い違い）だけは、同じ source_file を持つ全ファイルの全 products を集めて比べる。
 *
 * ルール
 *   R1 大きさの範囲外   ：長径が 3〜25mm の範囲外、または 短径 > 長径
 *   R2 文書内の食い違い ：同じ添付文書（source_file）の中で、同じ製品（販売名＋規格）が別ファイルの抽出で
 *                         別の色・形になっている（同じ文書を複数回抽出した結果が一致しない）
 *                         ※ 別の規格・別の製品どうしで色・形が違うのは、実際の製剤でも普通にある（規格ごとに色を変える）ので
 *                           ルール違反にはせず、「参考」として件数と CSV の列（doc_colors / doc_shapes）に出す
 *   R3 刻印の取りこぼし ：刻印（表または裏）が「未確認」なのに、補足（imprint_note）に刻印らしい文字列があり、
 *                         それが表・裏のどちらにも入っていない
 *   R4 null            ：形（shape）、または大きさ（size_long_mm / size_short_mm）が null
 *
 * 怪しい順：該当ルール数が多い順 → R1 > R3 > R2 > R4 の優先順 → YJコード順
 */
const fs = require("fs");
const path = require("path");
const { norm, readJsonDir, parseCsv, csvCell, mdTable } = require("./lib.cjs");

const ROOT = path.resolve(__dirname, "../..");
const DRAFTS_DIR = path.join(ROOT, "data/parent/drafts/claude-sonnet-5-5");
const NAIFUKU = path.join(ROOT, "data/parent/naifuku-tablets-20261101.csv");
const REPORT_MD = path.join(ROOT, "reports/check-parent.md");
const REPORT_CSV = path.join(ROOT, "reports/check-parent.csv");

const SIZE_MIN = 3;
const SIZE_MAX = 25;

const RULES = {
  R1: { label: "大きさの範囲外（長径 3〜25mm 外、または短径>長径）", weight: 4 },
  R3: { label: "刻印が未確認なのに補足に刻印らしい文字列", weight: 3 },
  R2: { label: "同じ添付文書内で、同じ製品の色・形が抽出ごとに食い違う", weight: 2 },
  R4: { label: "形・大きさが null", weight: 1 },
};
const RULE_ORDER = ["R1", "R3", "R2", "R4"];

/** 「未確認」「なし」など、刻印の値として実体がないもの */
const NON_IMPRINT = new Set(["", "未確認", "なし", "無し", "null"]);

/**
 * 補足（imprint_note）から「刻印らしい文字列」を拾う。
 *  a) 「識別コード／識別記号／識別表示／本体表示／刻印」の直後の英数字コード（例：識別コードEP200、識別コード：NTBC2mg）
 *  b) 「…」『…』“…” で囲まれた、英数字を含む短い文字列（例：「10」「TCK」）
 *  c) 英字1〜6字＋（空白/ハイフン）＋数字1〜4桁 の並び（例：SW 093、TSU574、MO-283）
 * 単位つきの数値（7.0mm、約220mg、3号）や「未確認」「なし」は除く。
 */
function imprintCandidates(note) {
  if (!note) return [];
  const s = String(note).normalize("NFKC");
  const found = new Set();
  const add = (t) => {
    const v = t.replace(/^[\s:：は、。・]+|[\s、。・,)）]+$/g, "");
    if (!v) return;
    if (NON_IMPRINT.has(v)) return;
    if (/^(約)?\d+(\.\d+)?\s*(mm|mg|g|μg|cm|号|mL|%)$/i.test(v)) return; // 単位つきの数値
    if (/^\d+(\.\d+)?$/.test(v) && Number(v) > 999) return; // 重量などの大きな数
    if (!/[A-Za-z0-9Ⓐ-Ⓩ]/.test(v)) return; // 英数字を含まないものは刻印らしさが薄い（和文の説明）
    if (/[\u3041-\u3096]/.test(v)) return; // ひらがなを含むものは説明文（例：「錠剤印字は2通りある」）
    if (/(識別|刻印|印字|包装|コード|PTP|シート)/i.test(v)) return; // キーワードそのもの、包装の表示
    if (/\d\s*号/.test(v)) return; // カプセルの号数（例：「4号カプセル」）
    if (v.length > 24) return;
    found.add(v);
  };
  // a) キーワードの直後
  const kw = /(識別コード|識別記号|識別表示|本体表示|刻印|印字|識別番号)\s*(?:は|として|：|:|が|を|の|、)?\s*[「『“"]?([A-Za-zⒶ-Ⓩ0-9][A-Za-zⒶ-Ⓩ0-9 \-\/／・.]{0,20}?)[」』”"]?(?=[\s、。）)はがをにとで（(]|$)/g;
  let m;
  while ((m = kw.exec(s))) add(m[2]);
  // b) かっこ付き
  const quoted = /[「『“"]([^」』”"]{1,24})[」』”"]/g;
  while ((m = quoted.exec(s))) add(m[1]);
  // c) 英字＋数字のコード
  const code = /(?<![A-Za-z0-9])([A-Za-zⒶ-Ⓩ]{1,6}[ \-]?\d{1,4})(?![A-Za-z0-9]|\s?(mm|mg|g|号|μg|mL))/g;
  while ((m = code.exec(s))) add(m[1]);
  return [...found];
}

/** 刻印候補が表・裏のどちらかに（空白・記号を無視して）含まれているか */
const imprintKey = (v) => norm(v).replace(/[\-ー－・.／/|｜]/g, "").toLowerCase();
function coveredByImprint(cand, front, back) {
  const c = imprintKey(cand);
  if (!c) return true;
  return [front, back].some((x) => {
    const k = imprintKey(x);
    return k && !NON_IMPRINT.has(norm(x)) && (k.includes(c) || c.includes(k));
  });
}

function loadNaifuku() {
  const rows = parseCsv(fs.readFileSync(NAIFUKU, "utf8"));
  const h = rows[0];
  const idx = Object.fromEntries(h.map((c, i) => [c, i]));
  const map = new Map();
  for (const r of rows.slice(1)) {
    if (!r[idx.yj_code]) continue;
    const spec = r[idx.strength] || "";
    const strengthOnly = (spec.match(/^(.+?)1(錠|カプセル)$/) || [])[1] || spec;
    map.set(r[idx.yj_code], { brand_name: r[idx.brand_name], maker: r[idx.maker], strength: strengthOnly, dosage_form: r[idx.dosage_form] });
  }
  return map;
}

/** 品目の product を選ぶ：販売名一致 → 規格一致 → 先頭。how に選び方を返す */
function pickPrimary(products, info) {
  if (!products || !products.length) return { p: null, how: "none" };
  const name = info && info.brand_name ? norm(info.brand_name) : "";
  const byName = name ? products.find((p) => norm(p.product_name) === name) : null;
  if (byName) return { p: byName, how: "name" };
  const strength = info && info.strength ? norm(info.strength) : "";
  const byStrength = strength ? products.find((p) => norm(p.strength) === strength) : null;
  if (byStrength) return { p: byStrength, how: "strength" };
  return { p: products[0], how: "first" };
}

function checkParent() {
  const naifuku = loadNaifuku();
  const files = readJsonDir(DRAFTS_DIR);

  // ルール2 の下ごしらえ：source_file ごとに products を集める
  const byDoc = new Map(); // source_file -> [{yj, product}]
  for (const { file, data: d } of files) {
    const yj = file.replace(/\.json$/, "");
    for (const p of d.products || []) {
      if (!byDoc.has(d.source_file)) byDoc.set(d.source_file, []);
      byDoc.get(d.source_file).push({ yj, p });
    }
  }
  const docInfo = new Map(); // source_file -> { colors:[], shapes:[], sameProductDiff:[{name, values}], strengths }
  for (const [doc, list] of byDoc) {
    const colors = new Set(), shapes = new Set(), strengths = new Set();
    const perProduct = new Map(); // product_name+strength -> Map("color|shape" -> yj[])
    for (const { yj, p } of list) {
      if (p.color != null && norm(p.color) !== "") colors.add(norm(p.color));
      if (p.shape != null && norm(p.shape) !== "") shapes.add(norm(p.shape));
      strengths.add(norm(p.strength));
      const k = norm(p.product_name) + "|" + norm(p.strength);
      if (!perProduct.has(k)) perProduct.set(k, new Map());
      const vk = `${norm(p.color)}|${norm(p.shape)}`;
      const m = perProduct.get(k);
      if (!m.has(vk)) m.set(vk, []);
      m.get(vk).push(yj);
    }
    const sameProductDiff = [...perProduct.entries()]
      .filter(([, v]) => v.size > 1)
      .map(([k, v]) => ({ name: k.split("|")[0], values: [...v.entries()].map(([vk, yjs]) => `${vk.replace("|", "／")}（${yjs.join(",")}）`) }));
    docInfo.set(doc, { colors: [...colors], shapes: [...shapes], strengths: strengths.size, sameProductDiff });
  }
  const docVariantCount = { color: 0, shape: 0, either: 0 };
  for (const di of docInfo.values()) {
    if (di.colors.length > 1) docVariantCount.color++;
    if (di.shapes.length > 1) docVariantCount.shape++;
    if (di.colors.length > 1 || di.shapes.length > 1) docVariantCount.either++;
  }

  const items = [];
  const ruleCount = { R1: 0, R2: 0, R3: 0, R4: 0 };
  const sub = { r1_long_out: 0, r1_short_gt_long: 0, r2_docs: 0, ref_color_variants: 0, ref_shape_variants: 0, r3_front: 0, r3_back_only: 0, r4_shape: 0, r4_size_long: 0, r4_size_short: 0, r4_size: 0, no_products: 0, pick: { name: 0, strength: 0, first: 0, none: 0 } };
  sub.r2_docs = [...docInfo.values()].filter((d) => d.sameProductDiff.length).length;

  for (const { file, data: d } of files) {
    const yj = file.replace(/\.json$/, "");
    const info = naifuku.get(yj) || {};
    const { p, how } = pickPrimary(d.products, info);
    sub.pick[how]++;
    const di = docInfo.get(d.source_file) || { colors: [], shapes: [], sameProductDiff: [] };
    if (di.colors.length > 1) sub.ref_color_variants++;
    if (di.shapes.length > 1) sub.ref_shape_variants++;
    const hits = [];
    const detail = [];
    if (!p) {
      sub.no_products++;
      hits.push("R4");
      detail.push("products が空（抽出できていない）");
    } else {
      const L = p.size_long_mm, S = p.size_short_mm;
      // R1
      const r1 = [];
      if (typeof L === "number" && (L < SIZE_MIN || L > SIZE_MAX)) { r1.push(`長径 ${L}mm が ${SIZE_MIN}〜${SIZE_MAX} の外`); sub.r1_long_out++; }
      if (typeof L === "number" && typeof S === "number" && S > L) { r1.push(`短径 ${S} > 長径 ${L}`); sub.r1_short_gt_long++; }
      if (r1.length) { hits.push("R1"); detail.push(...r1); }
      // R2：同じ製品が、同じ文書の別ファイルの抽出で別の色・形になっている
      if (di.sameProductDiff.length) {
        hits.push("R2");
        detail.push(`同じ添付文書 ${d.source_file} 内で同じ製品の値が食い違う：` + di.sameProductDiff.map((x) => `${x.name} → ${x.values.join(" vs ")}`).join("； "));
      }
      // R3
      const fUn = norm(p.imprint_front) === "未確認", bUn = norm(p.imprint_back) === "未確認";
      if (fUn || bUn) {
        const cands = imprintCandidates(p.imprint_note).filter((c) => !coveredByImprint(c, p.imprint_front, p.imprint_back));
        if (cands.length) {
          hits.push("R3");
          detail.push(`刻印 表=${p.imprint_front ?? "null"} 裏=${p.imprint_back ?? "null"} なのに補足に「${cands.join("」「")}」`);
          if (fUn) sub.r3_front++; else sub.r3_back_only++;
        }
      }
      // R4
      const r4 = [];
      if (p.shape == null) { r4.push("形が null"); sub.r4_shape++; }
      if (L == null) sub.r4_size_long++;
      if (S == null) sub.r4_size_short++;
      if (L == null || S == null) { r4.push(`大きさが null（長径 ${L ?? "null"}／短径 ${S ?? "null"}）`); sub.r4_size++; }
      if (r4.length) { hits.push("R4"); detail.push(...r4); }
    }
    for (const h of hits) ruleCount[h]++;
    if (hits.length) {
      const score = hits.reduce((a, h) => a + RULES[h].weight, 0);
      items.push({
        yj, brand_name: info.brand_name || (p && p.product_name) || "", maker: info.maker || "", strength: (p && p.strength) || info.strength || "",
        rules: hits, score, detail,
        imprint_front: p ? p.imprint_front : null, imprint_back: p ? p.imprint_back : null, imprint_note: p ? p.imprint_note : null,
        color: p ? p.color : null, shape: p ? p.shape : null, size_long_mm: p ? p.size_long_mm : null, size_short_mm: p ? p.size_short_mm : null,
        doc_colors: di.colors.join("／"), doc_shapes: di.shapes.join("／"), source_file: d.source_file, source_url: d.source_url,
      });
    }
  }
  items.sort((a, b) => b.rules.length - a.rules.length || b.score - a.score || (a.yj < b.yj ? -1 : 1));
  return { fileCount: files.length, docCount: byDoc.size, docVariantCount, ruleCount, sub, items };
}

function writeReports(r) {
  const flagged = r.items.length;
  const md = [];
  md.push("# 親マスタ下書きのルール検査（data/parent/drafts/claude-sonnet-5-5）");
  md.push("");
  md.push(`実行：${new Date().toISOString()}　スクリプト：scripts/eval/check-parent.cjs`);
  md.push("");
  md.push(`- 検査した品目：${r.fileCount}（添付文書 ${r.docCount} 文書）`);
  md.push(`- 1つ以上のルールに該当：${flagged} 品目（${((flagged / r.fileCount) * 100).toFixed(1)}%）`);
  md.push(`- 一覧（CSV）：reports/check-parent.csv（怪しい順）`);
  md.push("");
  md.push("検査の単位は品目（ファイル＝YJコード）。各ファイルの products のうち、厚労省リストの販売名に一致する product を見る（無ければ規格一致、それも無ければ先頭）。ルール2だけは、同じ添付文書（source_file）を持つ全ファイルの全 products を集めて比べる。");
  md.push("");
  md.push("## ルール別の件数");
  md.push("");
  md.push(mdTable(["ルール", "内容", "品目数"], RULE_ORDER.map((k) => [k, RULES[k].label, r.ruleCount[k]])));
  md.push("");
  md.push("内訳：");
  md.push(`- R1：長径が範囲外 ${r.sub.r1_long_out}、短径>長径 ${r.sub.r1_short_gt_long}`);
  md.push(`- R2：同じ製品の値が抽出ごとに食い違う文書 ${r.sub.r2_docs}（該当品目 ${r.ruleCount.R2}）`);
  md.push(`- R3：表が未確認 ${r.sub.r3_front}、裏だけ未確認 ${r.sub.r3_back_only}`);
  md.push(`- R4：形が null ${r.sub.r4_shape}、長径が null ${r.sub.r4_size_long}、短径が null ${r.sub.r4_size_short}（どちらかが null ${r.sub.r4_size}）、products が空 ${r.sub.no_products}`);
  md.push(`- 品目の product の選び方：販売名一致 ${r.sub.pick.name}、規格一致 ${r.sub.pick.strength}、先頭を使用 ${r.sub.pick.first}、products なし ${r.sub.pick.none}`);
  md.push("");
  md.push("## 参考：同じ添付文書の別規格・別製品で色・形が違う（ルール違反にはしていない）");
  md.push("");
  md.push(`- 色が 2 通り以上ある文書 ${r.docVariantCount.color}、形が 2 通り以上ある文書 ${r.docVariantCount.shape}（どちらか ${r.docVariantCount.either}／${r.docCount} 文書）`);
  md.push(`- そうした文書に属する品目：色 ${r.sub.ref_color_variants}、形 ${r.sub.ref_shape_variants}`);
  md.push("- 規格ごとに色や形を変えるのは実際の製剤で普通にあること（例：フェキソフェナジン 30mg round／60mg oblong、リクシアナ 15mg 黄／30mg 淡赤／60mg 楕円）なので、これだけでは怪しいと言えない。CSV の doc_colors / doc_shapes 列に文書内の値の一覧を出してあるので、必要なら絞り込める");
  md.push("");
  const byN = {};
  for (const it of r.items) byN[it.rules.length] = (byN[it.rules.length] || 0) + 1;
  md.push("## 該当ルール数ごとの品目数");
  md.push("");
  md.push(mdTable(["該当ルール数", "品目数"], Object.keys(byN).sort((a, b) => b - a).map((k) => [k, byN[k]])));
  md.push("");
  md.push("## 該当品目（怪しい順）");
  md.push("");
  md.push("並び順：該当ルール数が多い順 → R1 > R3 > R2 > R4 → YJコード順。全件は CSV に。");
  md.push("");
  md.push(
    mdTable(
      ["#", "YJ", "販売名", "メーカー", "ルール", "内容"],
      r.items.map((it, i) => [i + 1, it.yj, it.brand_name, it.maker, it.rules.join(" "), it.detail.join("； ")])
    )
  );
  md.push("");
  fs.mkdirSync(path.dirname(REPORT_MD), { recursive: true });
  fs.writeFileSync(REPORT_MD, md.join("\n"));

  const cols = ["rank", "yj_code", "brand_name", "maker", "strength", "rules", "rule_count", "detail", "imprint_front", "imprint_back", "imprint_note", "color", "shape", "size_long_mm", "size_short_mm", "doc_colors", "doc_shapes", "source_file", "source_url"];
  const csv = [cols.join(",")];
  r.items.forEach((it, i) => {
    csv.push([i + 1, it.yj, it.brand_name, it.maker, it.strength, it.rules.join(" "), it.rules.length, it.detail.join("； "), it.imprint_front, it.imprint_back, it.imprint_note, it.color, it.shape, it.size_long_mm, it.size_short_mm, it.doc_colors, it.doc_shapes, it.source_file, it.source_url].map(csvCell).join(","));
  });
  fs.writeFileSync(REPORT_CSV, "﻿" + csv.join("\n") + "\n");
}

if (require.main === module) {
  const r = checkParent();
  writeReports(r);
  console.log(`check-parent: ${r.fileCount} 品目（${r.docCount} 文書）、該当 ${r.items.length} 品目`);
  for (const k of RULE_ORDER) console.log(`  ${k} ${RULES[k].label}: ${r.ruleCount[k]}`);
  console.log(`  → ${path.relative(ROOT, REPORT_MD)}, ${path.relative(ROOT, REPORT_CSV)}`);
}

module.exports = { imprintCandidates, coveredByImprint, checkParent, SIZE_MIN, SIZE_MAX };
