/**
 * PMDA から添付文書PDFを取得し、出典情報をマスタに反映する
 *   npx tsx scripts/fetch-pdfs.ts            → data/pmda-sources.json の URL を pdfs/ に取得（既にあれば飛ばす）
 *   npx tsx scripts/fetch-pdfs.ts --apply    → 取得後、source_url / source_revision / source_page をマスタに書く
 * PDF はコミットしない（.gitignore）。外観（刻印・色・大きさ）は scripts/extract.ts で Claude に書き写させ、人が確認する。
 * --apply が書くのは機械的に取れる情報だけ：
 *   source_url      … pmda-sources.json の URL
 *   source_revision … PDF 1ページ目の「YYYY年M月改訂（第N版）」（pdftotext。読めなければ触らない）
 *   source_page     … 「3.2 製剤の性状」が載っているページ（pdftotext。読めなければ触らない）
 * すでに値が入っている項目は上書きしない（Claude 抽出や人の修正を優先）。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { TabletSchema, type Tablet } from "../lib/types";

const SOURCES = "data/pmda-sources.json";
const MASTER = "data/master.json";
const PDF_DIR = "pdfs";

type Source = { url: string; pmda_name?: string };
const sources = Object.fromEntries(
  Object.entries(JSON.parse(fs.readFileSync(SOURCES, "utf8")) as Record<string, Source | string>).filter(
    ([k, v]) => k !== "_note" && typeof v === "object",
  ),
) as Record<string, Source>;

function pdfPath(url: string) {
  return path.join(PDF_DIR, `${url.split("/").pop()}.pdf`);
}

function download(url: string) {
  const out = pdfPath(url);
  if (fs.existsSync(out) && fs.statSync(out).size > 0) return out;
  fs.mkdirSync(PDF_DIR, { recursive: true });
  execFileSync("curl", ["-sS", "-L", "--max-time", "120", "-A", "Mozilla/5.0", url, "-o", out], { stdio: "inherit" });
  const head = fs.readFileSync(out).subarray(0, 5).toString();
  if (!head.startsWith("%PDF")) {
    fs.unlinkSync(out);
    throw new Error(`PDFではありませんでした: ${url}`);
  }
  return out;
}

function pageText(pdf: string, page: number): string | null {
  const r = spawnSync("pdftotext", ["-layout", "-f", String(page), "-l", String(page), pdf, "-"], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return r.stdout;
}
function pageCount(pdf: string): number {
  const r = spawnSync("pdfinfo", [pdf], { encoding: "utf8" });
  const m = /^Pages:\s+(\d+)/m.exec(r.stdout ?? "");
  return m ? Number(m[1]) : 0;
}

/** 1ページ目の改訂年月。複数あれば最新を選ぶ。「＊2026年 2 月改訂（第2版）」→「2026年2月改訂（第2版）」 */
function findRevision(pdf: string): string | null {
  const t = pageText(pdf, 1);
  if (!t) return null;
  const re = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(改訂|作成)\s*（\s*第\s*(\d+)\s*版[^）]*）/g;
  let best: { key: number; text: string } | null = null;
  for (const m of t.matchAll(re)) {
    const key = Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[4]);
    if (!best || key > best.key) best = { key, text: `${m[1]}年${m[2]}月${m[3]}（第${m[4]}版）` };
  }
  return best?.text ?? null;
}
/** 「3.2 製剤の性状」が載っているページ（1始まり） */
function findAppearancePage(pdf: string): number | null {
  const n = pageCount(pdf);
  for (let p = 1; p <= n; p++) {
    const t = pageText(pdf, p);
    if (t && /3\.2\s*製剤の性状/.test(t)) return p;
  }
  return null;
}

const apply = process.argv.includes("--apply");
const master = (JSON.parse(fs.readFileSync(MASTER, "utf8")) as unknown[]).map((m) => TabletSchema.parse(m)) as Tablet[];
let changed = 0;
for (const t of master) {
  const s = sources[t.id];
  if (!s) {
    console.log(`- ${t.id}: pmda-sources.json に出典がありません`);
    continue;
  }
  const pdf = download(s.url);
  const rev = findRevision(pdf);
  const page = findAppearancePage(pdf);
  console.log(`- ${t.id}: ${path.basename(pdf)} | 改訂: ${rev ?? "（文字が取れない）"} | 性状: ${page ? `p${page}` : "（文字が取れない）"}`);
  if (!apply) continue;
  const before = JSON.stringify(t);
  t.source_url ??= s.url;
  if (t.source_url !== s.url) console.log(`    注意: マスタの source_url と pmda-sources.json が違います（マスタ側を優先）`);
  t.source_revision ??= rev;
  t.source_page ??= page;
  if (JSON.stringify(t) !== before) changed++;
}
if (apply) {
  fs.writeFileSync(MASTER, JSON.stringify(master, null, 2) + "\n");
  console.log(`マスタに反映: ${changed}件（外観の値は変えていません）`);
}
