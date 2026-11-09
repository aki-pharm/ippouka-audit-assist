/**
 * 添付文書（PDF）ごとに、載っている全規格の外観を1回で抽出する（親マスタ用）。
 *   node scripts/extract-docs.cjs --limit 20 --model claude-haiku-5-5 [--budget-usd 60] [--parallel 3]
 * 対象：data/parent/products.csv の製品のうち、まだ下書きが無いものの添付文書（doc_id 単位）
 * 出力：data/parent/drafts-docs/<model>/<doc_id>.json（products: 規格ごとの配列、expected_products: その文書に載るはずの製品名）
 * 費用は usage から概算し、--budget-usd を超えたら新しい呼び出しを止める。
 */
const fs = require("fs");
const path = require("path");
const { execFileSync, spawn } = require("child_process");

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const LIMIT = Number(arg("--limit", 20));
const MODEL = arg("--model", "claude-haiku-5-5");
const PAR = Number(arg("--parallel", 3));
const BUDGET = Number(arg("--budget-usd", 60));
const PRICE = { "claude-haiku-5-5": [1, 5], "claude-sonnet-5-5": [3, 15], "claude-opus-5-5": [15, 75] }[MODEL] || [3, 15]; // $/Mトークン（概算）
const OUT = path.join("data/parent/drafts-docs", MODEL);
fs.mkdirSync(OUT, { recursive: true });
const PDF_DIR = "pdfs/parent";
fs.mkdirSync(PDF_DIR, { recursive: true });

function parseCsvLine(l) { const v = []; let cur = "", q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === "," && !q) { v.push(cur); cur = ""; } else cur += ch; } v.push(cur); return v; }
const prods = fs.readFileSync("data/parent/products.csv", "utf8").split("\n").slice(1).filter(Boolean).map((l) => { const v = parseCsvLine(l); return { key: v[0], name: v[1], maker: v[2], doc: v[3], group: v[5], strength: v[6], yj: v[7], in_mhlw: v[8] === "True" }; });
// 既に品目単位の下書きがある製品（厚労省リストと同名）は除き、残りの製品の文書を対象にする
const drafted = new Set(fs.readdirSync("data/parent/drafts/claude-sonnet-5-5").map((f) => f.replace(".json", "")));
const need = prods.filter((p) => !(p.yj && p.in_mhlw && drafted.has(p.yj)));
const docs = [...new Set(need.map((p) => p.doc))].filter((d) => !fs.existsSync(path.join(OUT, `${d}.json`))).slice(0, LIMIT);
console.log(`対象文書 ${docs.length}（未抽出の製品 ${need.length}）、モデル ${MODEL}、並列 ${PAR}、上限 $${BUDGET}`);

function ensurePdf(docId) {
  const f = path.join(PDF_DIR, `${docId}.pdf`);
  const isPdf = () => fs.existsSync(f) && fs.statSync(f).size > 1000 && fs.readFileSync(f).subarray(0, 5).toString() === "%PDF-";
  if (isPdf()) return f;
  execFileSync("curl", ["-sS", "-L", "--max-time", "120", "-A", "Mozilla/5.0", `https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetPDF/${docId}`, "-o", f]);
  if (!isPdf()) throw new Error("PDFではない（取得失敗）");
  return f;
}

let i = 0, ok = 0, ng = 0, usd = 0, tin = 0, tout = 0;
const t0 = Date.now();
async function worker() {
  while (i < docs.length) {
    if (usd > BUDGET) { console.log(`費用が上限 $${BUDGET} を超えたので停止（$${usd.toFixed(2)}）`); i = docs.length; break; }
    const d = docs[i++];
    const names = need.filter((p) => p.doc === d).map((p) => p.name);
    try {
      const pdf = ensurePdf(d);
      await new Promise((res, rej) => {
        const p = spawn("npx", ["tsx", "scripts/extract.ts", pdf, "--id", d, "--url", `https://www.pmda.go.jp/PmdaSearch/iyakuDetail/ResultDataSetPDF/${d}`, "--model", MODEL, "--out", OUT], { stdio: ["ignore", "pipe", "pipe"] });
        let err = "";
        p.stderr.on("data", (x) => (err += x));
        p.on("close", (c) => (c === 0 ? res() : rej(new Error(err.trim().split("\n").pop()))));
      });
      const file = path.join(OUT, `${d}.json`);
      const j = JSON.parse(fs.readFileSync(file, "utf8"));
      j.expected_products = names;
      fs.writeFileSync(file, JSON.stringify(j, null, 2));
      tin += j.usage.input; tout += j.usage.output;
      usd = (tin * PRICE[0] + tout * PRICE[1]) / 1e6;
      ok++;
      console.log(`OK  ${d} ${j.products.length}規格（期待 ${names.length}）$${usd.toFixed(2)}`);
    } catch (e) { ng++; console.log(`NG  ${d}: ${e.message.slice(0, 100)}`); }
  }
}
Promise.all(Array.from({ length: PAR }, worker)).then(() => {
  console.log(`完了 OK ${ok} / NG ${ng}、tokens in ${tin} out ${tout}、費用 ≈ $${usd.toFixed(2)}（${((Date.now() - t0) / 1000).toFixed(0)}秒）→ ${OUT}/`);
});
