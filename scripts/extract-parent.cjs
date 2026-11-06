/**
 * 親マスタの品目を、紐づけた添付文書PDFから一括で抽出する（下書き）。
 *   node scripts/extract-parent.cjs --limit 10 [--model claude-sonnet-5-5] [--yj 2149026F4190,...] [--parallel 3]
 * 入力：data/parent/naifuku-tablets-*.csv、data/parent/pmda-links.json
 * PDF は pdfs/parent/<doc_id>.pdf にキャッシュ（コミットしない）。
 * 出力：data/parent/drafts/<model>/<yj_code>.json（既にあれば飛ばす）
 */
const fs = require("fs");
const path = require("path");
const { execFileSync, spawn } = require("child_process");

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const LIMIT = Number(arg("--limit", 10));
const MODEL = arg("--model", "claude-opus-5-5");
const PAR = Number(arg("--parallel", 3));
const ONLY = (arg("--yj", "") || "").split(",").filter(Boolean);
const OUT = path.join("data/parent/drafts", MODEL); fs.mkdirSync(OUT, { recursive: true });
const PDF_DIR = "pdfs/parent"; fs.mkdirSync(PDF_DIR, { recursive: true });

const CSV = fs.readdirSync("data/parent").filter((f) => /^naifuku-tablets-\d+\.csv$/.test(f)).sort().pop();
const lines = fs.readFileSync(path.join("data/parent", CSV), "utf8").split(/\r?\n/).filter(Boolean);
const cols = lines[0].split(",");
const rows = lines.slice(1).map((l) => { const v = []; let cur = "", q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === "," && !q) { v.push(cur); cur = ""; } else cur += ch; } v.push(cur); return Object.fromEntries(cols.map((c, i) => [c, v[i] ?? ""])); });
const links = JSON.parse(fs.readFileSync("data/parent/pmda-links.json", "utf8"));

let todo = rows.filter((r) => links[r.yj_code] && (!ONLY.length || ONLY.includes(r.yj_code)) && !fs.existsSync(path.join(OUT, `${r.yj_code}.json`)));
if (!ONLY.length) todo = todo.slice(0, LIMIT);
console.log(`対象 ${todo.length} 品目、モデル ${MODEL}、並列 ${PAR}`);

function ensurePdf(docId) {
  const f = path.join(PDF_DIR, `${docId}.pdf`);
  if (fs.existsSync(f) && fs.statSync(f).size > 1000) return f;
  execFileSync("curl", ["-sS", "-L", "--max-time", "120", "-A", "Mozilla/5.0", `https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetPDF/${docId}`, "-o", f]);
  if (!fs.readFileSync(f).subarray(0, 5).toString().startsWith("%PDF")) { fs.unlinkSync(f); throw new Error("PDFではない"); }
  return f;
}
/** 規格の文字列（例「1mg1錠」「0.25mg1錠」「2.5mg1カプセル」）→ 添付文書で探す規格（例「1mg」） */
function strengthOf(r) { const m = r.strength.match(/^(.+?)1(錠|カプセル)$/); return m ? m[1] : r.strength; }

let i = 0, ok = 0, ng = 0; const t0 = Date.now();
async function worker() {
  while (i < todo.length) {
    const r = todo[i++]; const link = links[r.yj_code];
    try {
      const pdf = ensurePdf(link.doc_id);
      await new Promise((res, rej) => {
        const p = spawn("npx", ["tsx", "scripts/extract.ts", pdf, "--id", r.yj_code, "--strength", strengthOf(r), "--url", link.url, "--model", MODEL, "--out", OUT], { stdio: ["ignore", "pipe", "pipe"] });
        let err = ""; p.stderr.on("data", (d) => (err += d)); p.on("close", (c) => (c === 0 ? res() : rej(new Error(err.trim().split("\n").pop()))));
      });
      ok++; console.log(`OK  ${r.yj_code} ${r.brand_name}`);
    } catch (e) { ng++; console.log(`NG  ${r.yj_code} ${r.brand_name}: ${e.message.slice(0, 120)}`); }
  }
}
Promise.all(Array.from({ length: PAR }, worker)).then(() => {
  console.log(`完了 OK ${ok} / NG ${ng}（${((Date.now() - t0) / 1000).toFixed(0)}秒）→ ${OUT}/`);
});
