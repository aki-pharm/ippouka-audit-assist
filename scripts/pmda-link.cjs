/**
 * 親マスタの各品目に PMDA の添付文書（PDF）を紐づける。
 *   node scripts/pmda-link.cjs [--limit N] [--only 2149026F]
 * 入力：data/parent/naifuku-tablets-*.csv（厚労省リスト由来。yj_code, brand_name ...）
 * 方法：PMDA の GeneralList/<YJコード> は、同じ成分・剤形の全製品と添付文書PDFの一覧を GET で返す。
 *       YJコードの先頭8桁（成分7桁＋剤形1字）ごとに1回取得し、各行の販売名（popUp の全文）に品名が含まれる文書を選ぶ。
 * 出力：data/parent/pmda-links.json（yj_code → {doc_id, url, pdf_date, names, maker}）、data/parent/pmda-unmatched.csv
 * 取得した HTML は captures/pmda-gl/ にキャッシュ（コミットしない）。PMDA に負荷をかけないよう 0.7 秒間隔。
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const LIMIT = Number(arg("--limit") || 0);
const ONLY = arg("--only");
const CSV = fs.readdirSync("data/parent").filter((f) => /^naifuku-tablets-\d+\.csv$/.test(f)).sort().pop();
const CACHE = "captures/pmda-gl"; fs.mkdirSync(CACHE, { recursive: true });
const OUT = "data/parent/pmda-links.json";

function parseCsv(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter(Boolean);
  const cols = lines[0].split(",");
  return lines.slice(1).map((l) => { const v = []; let cur = "", q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === "," && !q) { v.push(cur); cur = ""; } else cur += ch; } v.push(cur); return Object.fromEntries(cols.map((c, i) => [c, v[i] ?? ""])); });
}
/** 名前の正規化：全角→半角、空白除去、※や記号の違いを吸収 */
function norm(s) { return s.normalize("NFKC").replace(/[\s※＊*]/g, "").replace(/[「『]/g, "「").replace(/[」』]/g, "」").replace(/‐|－|—|―/g, "-"); }

function fetchGL(yj) {
  const f = path.join(CACHE, `${yj.slice(0, 8)}.html`);
  if (fs.existsSync(f) && fs.statSync(f).size > 2000) return fs.readFileSync(f, "utf8");
  const url = `https://www.pmda.go.jp/PmdaSearch/iyakuDetail/GeneralList/${yj}`;
  const html = execFileSync("curl", ["-sS", "-L", "--max-time", "60", "-A", "Mozilla/5.0", url], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  fs.writeFileSync(f, html);
  execFileSync("sleep", ["0.7"]);
  return html;
}
function parseGL(html) {
  const docs = [];
  const body = html.replace(/<script[\s\S]*?<\/script>/g, "");
  for (const m of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const row = m[1];
    const pdf = row.match(/ResultDataSetPDF\/([0-9A-Z_]+)'>PDF\((\d{4})年(\d{2})月(\d{2})日\)/);
    if (!pdf) continue;
    const pop = row.match(/popUp\("([^"]*)"\)/);
    const names = (pop ? pop[1] : "").split("／").map((s) => s.trim()).filter(Boolean);
    const maker = (row.match(/<td>([^<]*(?:製造販売元|販売元|製造元)[^<]*)<\/td>/) || [, ""])[1].replace(/\s+/g, " ").trim();
    docs.push({ doc_id: pdf[1], pdf_date: `${pdf[2]}-${pdf[3]}-${pdf[4]}`, names, maker });
  }
  return docs;
}

const rows = parseCsv(fs.readFileSync(path.join("data/parent", CSV), "utf8"));
const groups = new Map();
for (const r of rows) { const k = r.yj_code.slice(0, 8); if (ONLY && k !== ONLY) continue; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
const links = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
const unmatched = [];
let n = 0, matched = 0, done = 0;
for (const [k, items] of groups) {
  if (LIMIT && n >= LIMIT) break;
  n++;
  let docs;
  try { docs = parseGL(fetchGL(items[0].yj_code)); } catch (e) { console.error("取得失敗", k, e.message.split("\n")[0]); for (const r of items) unmatched.push({ ...r, reason: "fetch_error" }); continue; }
  for (const r of items) {
    const target = norm(r.brand_name);
    const hits = docs.filter((d) => d.names.some((nm) => norm(nm) === target));
    const loose = hits.length ? hits : docs.filter((d) => d.names.some((nm) => norm(nm).includes(target) || target.includes(norm(nm))));
    const pick = (loose.length ? loose : []).sort((a, b) => (a.pdf_date < b.pdf_date ? 1 : -1))[0];
    if (pick) { links[r.yj_code] = { doc_id: pick.doc_id, url: `https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetPDF/${pick.doc_id}`, pdf_date: pick.pdf_date, pmda_names: pick.names, maker: pick.maker, match: hits.length ? "exact" : "loose", candidates: loose.length }; matched++; }
    else unmatched.push({ yj_code: r.yj_code, brand_name: r.brand_name, maker: r.maker, reason: docs.length ? "no_name_match" : "no_docs", docs: docs.length });
    done++;
  }
  if (n % 50 === 0) { fs.writeFileSync(OUT, JSON.stringify(links, null, 1)); console.log(`${n}/${groups.size} groups, matched ${matched}/${done}`); }
}
fs.writeFileSync(OUT, JSON.stringify(links, null, 1));
fs.writeFileSync("data/parent/pmda-unmatched.csv", "yj_code,brand_name,maker,reason,docs\n" + unmatched.map((u) => [u.yj_code, u.brand_name, u.maker, u.reason, u.docs ?? ""].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n") + "\n");
console.log(`groups ${n}, matched ${matched}/${done}, unmatched ${unmatched.length} → ${OUT}`);
