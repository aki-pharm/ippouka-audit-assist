/**
 * 処方箋の画像をまとめて読み取り、採点用に 1 処方 1 ファイルの JSON で保存する（アプリの /api/read-rx と同じプロンプト・スキーマ・呼び方）。
 *
 *   npx tsx scripts/read-rx-batch.ts [--images captures/rx-testset/variants] [--out captures/rx-runs/<モデル>]
 *        [--model claude-sonnet-5-5] [--only "__clean$"] [--max-usd 2] [--limit 20] [--force] [--dry-run]
 *   その後：node scripts/eval/score-rx.cjs --results captures/rx-runs/<モデル>
 *
 * - 画像のファイル名は docs/rx-testset.md の決まり（rx07-1__AKI__iphone__tilt.jpg）。同じ処方・同じ撮影のページ（-1, -2）は
 *   アプリと同じく 1 回の呼び出しにまとめる（4 枚まで）。出力は <out>/<処方>__<撮影者>__<機器>__<条件>.json
 * - 画像はアプリと同じく長辺 1600px・JPEG 画質 85 に縮小して送る（python3 と Pillow を使う。無ければ元のまま送り、警告を出す）
 * - --only：対象の絞り込み（出力名に対する正規表現）。例 "__clean$" で加工なしだけ、"^rx0[1-5]" で rx01〜05 だけ
 * - --max-usd：使ってよい上限（米ドル、既定 2）。呼ぶ前に、その 1 回の最悪の費用（入力＝見積もり×1.3 とそれまでの実際の入力の最大の
 *   大きい方 ＋ 出力 max_tokens 16,000 すべて）を取っておき、「使った額＋最悪の費用」が上限を超えるなら呼ばずに止める。
 *   ただし 1 回目は実際の入力を知らないので、入力が見積もりの 1.3 倍を超えると、その 1 回の分だけ上限を超えうる。例外で失敗した回は請求が分からないので
 *   最悪の費用を使ったものとして数える。料金は lib/api-prices.json（公式の料金表。全スクリプト共通）。知らないモデルは
 *   --price-in/--price-out（$/100万トークン）が必要
 * - すでに出力があるものは飛ばす（途中で止めても続きから）。--force で読み直す
 * - --dry-run：API を呼ばずに、対象・まとめ方・見積もりだけ出す（APIキー不要）
 * - 画像や読み取り結果の中身は画面に出さない（数だけ）
 * APIキーは ANTHROPIC_API_KEY または CLAUDE_API_KEY（環境変数。無ければ .env.local を読む）。
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

type Img = { base64: string; mediaType: "image/jpeg" | "image/png"; width: number | null; height: number | null };

type Price = { input: number; output: number; long?: { threshold: number; input: number; output: number } };
const MAX_OUTPUT_TOKENS = 16000; // lib/readRx.ts の READ_RX_MAX_TOKENS と同じ（実行時に確かめる）
const INPUT_MARGIN = 1.3; // 入力トークンの見積もり（画像 幅×高さ÷750）が外れても上限を守るための余裕
const MAX_IMAGES = 4; // app/api/read-rx と同じ
const MAX_BASE64_CHARS = 3_000_000; // app/api/read-rx と同じ
const EXT = /\.(jpe?g|png)$/i;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(name);

// リポジトリの一番上で実行する（npm の他のスクリプトと同じ）
const ROOT = process.cwd();
if (!fs.existsSync(path.join(ROOT, "lib/claude.ts"))) {
  console.error("リポジトリの一番上（package.json のある場所）で実行してください");
  process.exit(1);
}

/** lib/claude.ts の既定モデル（dry-run では SDK を読まずに済むよう、ファイルから読む） */
function defaultModel(): string {
  const src = fs.readFileSync(path.join(ROOT, "lib/claude.ts"), "utf8");
  const m = src.match(/export const MODEL = "([^"]+)"/);
  if (!m) throw new Error("lib/claude.ts の MODEL が読めない");
  return m[1];
}

/** 画像ファイル → 呼び出し単位（同じ処方・同じ撮影のページをまとめる） */
function groupImages(dir: string): Map<string, string[]> {
  const groups = new Map<string, { page: number; file: string }[]>();
  for (const f of fs.readdirSync(dir).filter((f) => EXT.test(f)).sort()) {
    const stem = f.replace(EXT, "");
    const [head, ...rest] = stem.split("__");
    const m = head.match(/^(.*?)-(\d+)$/);
    const rx = m ? m[1] : head;
    const page = m ? Number(m[2]) : 1;
    const key = [rx, ...rest].join("__");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ page, file: path.join(dir, f) });
  }
  const out = new Map<string, string[]>();
  for (const [k, v] of groups) out.set(k, v.sort((a, b) => a.page - b.page).map((x) => x.file));
  return out;
}

// アプリ（lib/image.ts）と同じ縮小：長辺 1600px 以下、JPEG 画質 85
const PY_RESIZE = `
import sys, io, base64
from PIL import Image, ImageOps
im = ImageOps.exif_transpose(Image.open(sys.argv[1])).convert("RGB")
s = min(1.0, 1600 / max(im.size))
if s < 1.0:
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
buf = io.BytesIO()
im.save(buf, "JPEG", quality=85)
sys.stdout.write(f"{im.width} {im.height}\\n" + base64.b64encode(buf.getvalue()).decode())
`;
let warnedNoPil = false;
function loadImage(file: string): Img {
  const r = spawnSync("python3", ["-I", "-c", PY_RESIZE, file], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status === 0 && r.stdout) {
    const nl = r.stdout.indexOf("\n");
    const [w, h] = r.stdout.slice(0, nl).split(" ").map(Number);
    return { base64: r.stdout.slice(nl + 1), mediaType: "image/jpeg", width: w, height: h };
  }
  if (!warnedNoPil) {
    console.warn("注意: python3 と Pillow で縮小できなかった。元の画像のまま送る（アプリとは条件が違う）");
    warnedNoPil = true;
  }
  return { base64: fs.readFileSync(file).toString("base64"), mediaType: /\.png$/i.test(file) ? "image/png" : "image/jpeg", width: null, height: null };
}

/** 入力トークンのおおよそ（画像は 幅×高さ÷750、文字は 2,000 と見る）。見積もり専用 */
const estInputTokens = (imgs: Img[]) => 2000 + imgs.reduce((a, i) => a + (i.width && i.height ? Math.ceil((i.width * i.height) / 750) : 2500), 0);

async function main() {
  const imagesDir = path.resolve(arg("--images") ?? path.join(ROOT, "captures/rx-testset/variants"));
  const model = arg("--model") ?? defaultModel();
  const outDir = path.resolve(arg("--out") ?? path.join(ROOT, "captures/rx-runs", model));
  const only = arg("--only") ? new RegExp(arg("--only")!) : null;
  const maxUsd = Number(arg("--max-usd") ?? 2);
  const limit = arg("--limit") ? Number(arg("--limit")) : Infinity;
  const dry = flag("--dry-run");
  const force = flag("--force");
  const prices = JSON.parse(fs.readFileSync(path.join(ROOT, "lib/api-prices.json"), "utf8")).models as Record<string, Price>;
  const price: Price | undefined = arg("--price-in") && arg("--price-out") ? { input: Number(arg("--price-in")), output: Number(arg("--price-out")) } : prices[model];
  if (!price) {
    console.error(`料金が分からないモデル: ${model}。--price-in と --price-out（$/100万トークン）を指定する`);
    process.exit(1);
  }
  if (!fs.existsSync(imagesDir)) {
    console.error(`画像のフォルダが無い: ${imagesDir}（python3 scripts/make-rx-variants.py で作る）`);
    process.exit(1);
  }
  const cost = (inTok: number, outTok: number) => {
    const p = price.long && inTok > price.long.threshold ? price.long : price;
    return (inTok * p.input + outTok * p.output) / 1e6;
  };
  // 入力は「見積もり×1.3」と「これまでに実際に使った入力の最大」の大きい方を取っておく（見積もりが外れても 2 回目からは学ぶ）
  let maxInputSeen = 0;
  const worstCase = (imgs: Img[]) => cost(Math.max(Math.ceil(estInputTokens(imgs) * INPUT_MARGIN), maxInputSeen), MAX_OUTPUT_TOKENS);

  let jobs = [...groupImages(imagesDir)].filter(([k]) => !only || only.test(k));
  const skipped = jobs.filter(([k]) => !force && fs.existsSync(path.join(outDir, `${k}.json`))).length;
  if (!force) jobs = jobs.filter(([k]) => !fs.existsSync(path.join(outDir, `${k}.json`)));
  jobs = jobs.slice(0, limit);
  const tooMany = jobs.filter(([, files]) => files.length > MAX_IMAGES);
  if (tooMany.length) {
    console.error(`1 回に送れる画像は ${MAX_IMAGES} 枚まで: ${tooMany.map(([k]) => k).join(", ")}`);
    process.exit(1);
  }
  console.log(`モデル ${model}（$${price.input}/$${price.output} per MTok）・対象 ${jobs.length} 回（画像 ${jobs.reduce((a, [, f]) => a + f.length, 0)} 枚）・出力済みで飛ばした ${skipped}・上限 $${maxUsd}`);

  if (dry) {
    let est = 0;
    let worst = 0;
    for (const [k, files] of jobs) {
      const imgs = files.map(loadImage);
      const t = estInputTokens(imgs);
      est += cost(t, 3000);
      worst = Math.max(worst, worstCase(imgs));
      console.log(`  ${k}：${files.map((f) => path.basename(f)).join(" + ")}（入力 約${t} トークン）`);
    }
    console.log(`見積もり（出力を 1 回 3,000 トークンと仮定）：約 $${est.toFixed(3)}。1 回の最悪の費用（上限の判定に取っておく額）：最大 $${worst.toFixed(3)}。API は呼んでいない（--dry-run）`);
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY && !process.env.CLAUDE_API_KEY && fs.existsSync(path.join(ROOT, ".env.local"))) {
    process.loadEnvFile(path.join(ROOT, ".env.local"));
  }
  if (!process.env.ANTHROPIC_API_KEY && !process.env.CLAUDE_API_KEY) {
    console.error("APIキーが未設定です。ANTHROPIC_API_KEY か CLAUDE_API_KEY を設定してください（API は呼んでいない）。");
    process.exit(1);
  }
  const { getClient } = await import("../lib/claude");
  const { readRx, READ_RX_MAX_TOKENS } = await import("../lib/readRx");
  const { fillStrengthFromName } = await import("../lib/rxFix");
  if (READ_RX_MAX_TOKENS !== MAX_OUTPUT_TOKENS) {
    console.error(`lib/readRx.ts の max_tokens（${READ_RX_MAX_TOKENS}）とランナーの最悪の見積もり（${MAX_OUTPUT_TOKENS}）が違う。MAX_OUTPUT_TOKENS を直す`);
    process.exit(1);
  }
  const client = getClient();
  if (!client) {
    console.error("APIキーが未設定です。ANTHROPIC_API_KEY か CLAUDE_API_KEY を設定してください。");
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });

  let spent = 0;
  let done = 0;
  let inSum = 0;
  let outSum = 0;
  let failed = 0;
  for (const [key, files] of jobs) {
    const imgs = files.map(loadImage);
    const big = imgs.find((i) => i.base64.length > MAX_BASE64_CHARS);
    const reserve = worstCase(imgs);
    if (!big && spent + reserve > maxUsd) {
      console.log(`上限 $${maxUsd} を超えうるので止める（使った $${spent.toFixed(4)}、次の 1 回の最悪 $${reserve.toFixed(4)}）。続けるなら --max-usd を上げて同じコマンド（済んだ分は飛ばす）`);
      break;
    }
    const rec: Record<string, unknown> = { key, model, images: files.map((f) => path.basename(f)), at: new Date().toISOString() };
    const t0 = Date.now();
    if (big) {
      rec.error = "画像が大きすぎる（アプリの上限を超える）";
    } else {
      try {
        const res = await readRx(client, imgs.map(({ base64, mediaType }) => ({ base64, mediaType })), model);
        const u = { input: res.usage.input_tokens, output: res.usage.output_tokens };
        const c = cost(u.input, u.output);
        spent += c;
        maxInputSeen = Math.max(maxInputSeen, u.input);
        inSum += u.input;
        outSum += u.output;
        // アプリ（/api/read-rx）と同じ後処理：規格の欄が空なら薬品名から入れる（lib/rxFix.ts）。入れた行の数を残す
        const fixed = res.parsed_output ? fillStrengthFromName(res.parsed_output) : null;
        Object.assign(rec, { result: fixed?.result ?? null, strength_filled: fixed?.filled ?? 0, usage: u, cost_usd: Number(c.toFixed(6)), stop_reason: res.stop_reason });
        if (!res.parsed_output) rec.error = `読み取り結果を解釈できなかった（stop_reason=${res.stop_reason}）`;
      } catch (e) {
        rec.error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
        // 請求されたか分からないので、最悪の費用を使ったものとして数える（見積もりを甘くしない）
        spent += reserve;
        rec.cost_reserved_usd = Number(reserve.toFixed(6));
      }
    }
    rec.elapsed_ms = Date.now() - t0;
    if (rec.error) failed++;
    done++;
    fs.writeFileSync(path.join(outDir, `${key}.json`), JSON.stringify(rec, null, 1) + "\n");
    const u = rec.usage as { input: number; output: number } | undefined;
    console.log(`  ${done}/${jobs.length} ${key}：${rec.error ? `失敗（${String(rec.error).slice(0, 80)}）` : `行 ${(rec.result as { items: unknown[] }).items.length}`}` +
      `${u ? `・入力 ${u.input}／出力 ${u.output} トークン・$${(rec.cost_usd as number).toFixed(4)}` : ""}・${((rec.elapsed_ms as number) / 1000).toFixed(1)} 秒`);
  }
  const summary = [
    `モデル ${model}・呼び出し ${done}（失敗 ${failed}）・入力 ${inSum}／出力 ${outSum} トークン`,
    `費用 $${spent.toFixed(4)}（1 回あたり $${done ? (spent / done).toFixed(4) : "-"}。例外で失敗した回は最悪の費用で数えている）`,
  ].join("\n");
  console.log(summary);
  // 採点スクリプトは *.json を全部読むので、まとめは .txt に
  fs.appendFileSync(path.join(outDir, "run-summary.txt"), `${new Date().toISOString()}\n${summary}\n\n`);
}

main().catch((e) => {
  console.error("失敗:", e instanceof Error ? e.message : e);
  process.exit(1);
});
