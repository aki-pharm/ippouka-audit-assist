// app/api/read-rx/route.ts から lib/readRx.ts への移動で、Claude の呼び方が変わっていないか。
//   node --test tests/rx/
// - 実際に lib/readRx.ts を（SDK と zod を仮のものにして）偽の client で呼び、main の route.ts にあった呼び出しと引数を比べる
// - route.ts の入口の確かめ（枚数・大きさ・形式・1 日の上限）とログが main と同じか
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { ROOT } = require("./helpers.cjs");

const git = (...a) => spawnSync("git", a, { cwd: ROOT, encoding: "utf8" });
const mainRef = ["origin/main", "main"].find((r) => git("rev-parse", "--verify", "-q", r).status === 0);
const mainFile = (f) => (mainRef ? git("show", `${mainRef}:${f}`) : { status: 1 });
const tsOk = Number(process.versions.node.split(".")[0]) >= 22 && process.features?.typescript;

const route = fs.readFileSync(path.join(ROOT, "app/api/read-rx/route.ts"), "utf8");
const readRxSrc = fs.readFileSync(path.join(ROOT, "lib/readRx.ts"), "utf8");

test("readRx を偽の client で呼ぶと、main の route.ts と同じ引数（モデル・max_tokens・effort・スキーマ・system・画像の並べ方）", { skip: (!tsOk && "Node の TypeScript 読み込みが無い") || (!mainRef && "main が無い") }, () => {
  const old = mainFile("app/api/read-rx/route.ts");
  assert.equal(old.status, 0);
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "readrx-")), "route.ts");
  fs.writeFileSync(tmp, old.stdout);
  const r = spawnSync(process.execPath, ["--no-warnings", "--import", path.join(__dirname, "readrx/register.mjs"), path.join(__dirname, "readrx/run.mjs"), ROOT, tmp], { encoding: "utf8" });
  fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout);
  assert.ok(o.oldCall, "main の呼び出しを評価できなかった");
  assert.deepEqual(o.newCall, o.oldCall);
  assert.equal(o.newCall.model, o.MODEL);
  assert.equal(o.newCall.max_tokens, 16000);
  assert.equal(o.newCall.output_config.effort, "high");
  assert.equal(o.newCall.output_config.format.__zodOutputFormat, o.rxSchemaId, "スキーマは RxReadResultSchema");
  assert.equal(o.newCall.system, o.READ_RX_SYSTEM);
  assert.equal(o.modelOverride, "claude-haiku-5-5", "ランナーの --model が効く");
  assert.deepEqual(o.returned, { ok: true }, "SDK の応答をそのまま返す");
  // 呼び出しの中に画像以外の物（ファイル名など）を足していない
  assert.equal(o.newCall.messages.length, 1);
  assert.equal(o.newCall.messages[0].content.length, 2 * 2 + 1);
});

// AKI が 11/11 に決めたもの：既定モデルを Sonnet 5.5 に、プロンプトに 3 行（規格は数値と単位が既定、配合錠の記号は数値が無いときだけ、徐放錠の補足は name_note へ。8512e9a で 2 行を言い直した）
const PROMPT_ADDED = [
  "- 規格は通常どおり数値と単位（例：5mg、0.25mg、500μg）を strength に入れ、薬品名にも処方箋の表記どおり残す。",
  "- 配合錠で数値の規格が無いときに限り、印字された記号（LD・HD・ULD・EX・A81・1番 など）を strength に入れる（薬品名にも残す）。記号も無ければ null。",
  "- 徐放錠の「（24時間持続）」「（12時間持続）」のような補足は name_note に入れ、薬品名には含めない（name_note には括弧を除いた「24時間持続」を入れる）。",
];
const diffLines = (f) => git("diff", "-U0", mainRef, "--", f).stdout.split("\n").filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l));

test("プロンプト：main との違いは AKI が決めた 3 行の追加だけ（消した行・変えた行なし、追加の場所は name_note の行の直後）", { skip: !mainRef && "main が無い" }, () => {
  assert.deepEqual(diffLines("lib/prompts.ts"), PROMPT_ADDED.map((l) => `+${l}`));
  const now = fs.readFileSync(path.join(ROOT, "lib/prompts.ts"), "utf8").split("\n");
  const i = now.findIndex((l) => l.includes("は name_note に分ける。"));
  assert.deepEqual(now.slice(i + 1, i + 1 + PROMPT_ADDED.length), PROMPT_ADDED);
});

test("既定モデル：claude-sonnet-5-5（AKI 11/11）。lib/claude.ts の main との違いはモデルの行とその説明の 1 行だけ。画像の縮小（lib/image.ts）は main と同じ", { skip: !mainRef && "main が無い" }, () => {
  assert.match(fs.readFileSync(path.join(ROOT, "lib/claude.ts"), "utf8"), /^export const MODEL = "claude-sonnet-5-5";$/m);
  const d = diffLines("lib/claude.ts");
  assert.deepEqual(d.filter((l) => !/^\+\/\//.test(l)), ['-export const MODEL = "claude-opus-5-5";', '+export const MODEL = "claude-sonnet-5-5";']);
  assert.ok(d.filter((l) => /^\+\/\//.test(l)).length <= 1, "説明の行は 1 行まで");
  assert.equal(git("diff", "--quiet", mainRef, "--", "lib/image.ts").status, 0, "lib/image.ts が main と違う");
});

test("lib/types.ts は読み取りのスキーマ（PerTiming・RxItem・RxReadResult）の部分だけ main と同じ（マスタ・表の欄は変わってよい）", { skip: !mainRef && "main が無い" }, () => {
  const block = (src, from, to) => {
    const a = src.indexOf(from);
    const b = src.indexOf(to, a);
    assert.ok(a >= 0 && b > a, `${from} が見つからない`);
    return src.slice(a, b);
  };
  const now = fs.readFileSync(path.join(ROOT, "lib/types.ts"), "utf8");
  const old = mainFile("lib/types.ts").stdout;
  for (const [from, to] of [["export const PerTimingSchema", "export type"], ["export const RxItemSchema", "export type RxItem "], ["export const RxReadResultSchema", "export type RxReadResult "]]) {
    assert.equal(block(now, from, to), block(old, from, to), from);
  }
});

test("route.ts：変わったのは呼び出しの移動と規格の後処理（fillStrengthFromName）だけ（入口の確かめ・上限・応答・ログは main と同じ）", { skip: !mainRef && "main が無い" }, () => {
  const old = mainFile("app/api/read-rx/route.ts").stdout;
  const keep = [
    "const MAX_IMAGES = 4;",
    "const MAX_BASE64_CHARS = 3_000_000;",
    "if (!images.length)",
    "if (images.length > MAX_IMAGES)",
    'typeof img.base64 !== "string" || img.base64.length > MAX_BASE64_CHARS',
    'img.mediaType !== "image/jpeg" && img.mediaType !== "image/png"',
    "const budget = takeDailyBudget();",
    'response.stop_reason === "refusal"',
    "usage: { input: response.usage.input_tokens, output: response.usage.output_tokens }",
    'console.error("read-rx failed:", msg.slice(0, 200));',
  ];
  for (const k of keep) {
    assert.ok(old.includes(k), `main にあるはず: ${k}`);
    assert.ok(route.includes(k), `route.ts から消えた: ${k}`);
  }
  // main との違い（追加・削除の行）は、呼び出しの lib/readRx.ts への移動と、規格の後処理（lib/rxFix.ts の fillStrengthFromName）だけ
  const d = git("diff", "-U0", mainRef, "--", "app/api/read-rx/route.ts").stdout.split("\n").filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l));
  const added = d.filter((l) => l.startsWith("+")).map((l) => l.slice(1).trim());
  assert.deepEqual(added, [
    'import { getClient, takeDailyBudget } from "@/lib/claude";',
    'import { readRx, type RxImage } from "@/lib/readRx";',
    'import { fillStrengthFromName } from "@/lib/rxFix";',
    "type Body = { images?: RxImage[] };",
    "const response = await readRx(client, images);",
    "const parsed = response.parsed_output;",
    'if (!parsed) return NextResponse.json({ error: "読み取り結果を解釈できませんでした" }, { status: 502 });',
    "// 規格の欄が空で、薬品名に規格が書いてあれば名前から入れる（決まった手順。lib/rxFix.ts）",
    "const { result } = fillStrengthFromName(parsed);",
  ]);
  const removed = d.filter((l) => l.startsWith("-")).map((l) => l.slice(1).trim());
  // 消した行は、移した呼び出し・import・型と、result の 2 行だけ
  assert.ok(removed.includes("const result = response.parsed_output;"));
  assert.ok(removed.includes("const response = await client.messages.parse({"));
  assert.ok(removed.every((l) => !/console|takeDailyBudget\(\)|MAX_|status: 4/.test(l)), removed.join("\n"));
  // 確かめの順番も同じ（上限の前に budget を取らない）
  assert.ok(route.indexOf("takeDailyBudget()") > route.indexOf("img.mediaType !=="));
  assert.ok(route.indexOf("await readRx(client, images)") > route.indexOf("takeDailyBudget()"));
  // ログは失敗時のエラー文 200 文字だけ（画像・結果・usage は出さない）
  const logs = route.match(/console\.\w+\([^)]*\)/g) ?? [];
  assert.deepEqual(logs, ['console.error("read-rx failed:", msg.slice(0, 200)']);
  assert.equal((old.match(/console\.\w+\(/g) ?? []).length, 1);
});

test("lib/readRx.ts はログを出さず、環境変数も読まない", () => {
  assert.doesNotMatch(readRxSrc, /console\./);
  assert.doesNotMatch(readRxSrc, /process\.env/);
  assert.doesNotMatch(readRxSrc, /fs\.|writeFile/);
});

test("ランナー（scripts/read-rx-batch.ts）は画像や読み取り結果の中身を画面に出さない（行数・トークン・費用だけ）", () => {
  const src = fs.readFileSync(path.join(ROOT, "scripts/read-rx-batch.ts"), "utf8");
  const logs = src.match(/console\.(log|warn|error)\([\s\S]*?\);\n/g) ?? [];
  for (const l of logs) {
    assert.doesNotMatch(l, /base64|parsed_output|JSON\.stringify|rec\.result\)/, l.slice(0, 120));
  }
  // 費用の上限は既定 $2、--dry-run は API を呼ぶ前に戻る
  assert.match(src, /arg\("--max-usd"\) \?\? 2/);
  assert.ok(src.indexOf("if (dry)") < src.indexOf("await import(\"../lib/readRx\")"));
  // アプリと同じ枚数・大きさの上限
  assert.match(src, /const MAX_IMAGES = 4;/);
  assert.match(src, /const MAX_BASE64_CHARS = 3_000_000;/);
});
