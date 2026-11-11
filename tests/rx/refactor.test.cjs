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

test("プロンプト・既定モデル・画像の縮小は main と同じ。lib/types.ts は読み取りのスキーマ（PerTiming・RxItem・RxReadResult）の部分だけ main と同じ", { skip: !mainRef && "main が無い" }, () => {
  // feature/matching-rules で lib/types.ts（マスタの欄・表の行の欄）と lib/master.ts（照合）は変わってよい。読み取りに効く所だけ見る
  for (const f of ["lib/prompts.ts", "lib/claude.ts", "lib/image.ts"]) {
    const d = git("diff", "--quiet", mainRef, "--", f);
    assert.equal(d.status, 0, `${f} が main と違う`);
  }
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

test("route.ts：変わったのは呼び出しの移動だけ（入口の確かめ・上限・応答・ログは main と同じ）", { skip: !mainRef && "main が無い" }, () => {
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
    "const result = response.parsed_output;",
    "usage: { input: response.usage.input_tokens, output: response.usage.output_tokens }",
    'console.error("read-rx failed:", msg.slice(0, 200));',
  ];
  for (const k of keep) {
    assert.ok(old.includes(k), `main にあるはず: ${k}`);
    assert.ok(route.includes(k), `route.ts から消えた: ${k}`);
  }
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
