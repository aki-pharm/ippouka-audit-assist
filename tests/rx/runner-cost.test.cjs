// scripts/read-rx-batch.ts の費用の上限（--max-usd）と料金表（lib/api-prices.json）。
// API は呼ばない：lib/readRx を偽物（readrx/fake-readrx.mjs）に差し替え、SDK・zod も仮のものにして、ランナーをそのまま動かす。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { ROOT, DATA } = require("./helpers.cjs");

const tsOk = Number(process.versions.node.split(".")[0]) >= 22 && process.features?.typescript;
const prices = JSON.parse(fs.readFileSync(path.join(ROOT, "lib/api-prices.json"), "utf8"));

/** 画像 n 処方分（rx01〜）を一時フォルダに置き、偽の readRx でランナーを走らせる */
function run({ n = 6, maxUsd, fake = "max", input = 5000, model }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rxrun-"));
  const img = path.join(dir, "img");
  fs.mkdirSync(img);
  for (let i = 1; i <= n; i++) {
    const id = `rx${String(i).padStart(2, "0")}`;
    fs.copyFileSync(path.join(DATA, "images", `${id}-1.png`), path.join(img, `${id}-1__QA__t__clean.png`));
  }
  const out = path.join(dir, "out");
  const args = ["--no-warnings", "--import", path.join(__dirname, "readrx/register-fake.mjs"), "scripts/read-rx-batch.ts", "--images", img, "--out", out, "--max-usd", String(maxUsd)];
  if (model) args.push("--model", model);
  const r = spawnSync(process.execPath, args, {
    cwd: ROOT, encoding: "utf8",
    env: { ...process.env, CLAUDE_API_KEY: "fake-key-for-test", ANTHROPIC_API_KEY: "", RX_FAKE: fake, RX_FAKE_INPUT: String(input) },
  });
  const recs = fs.existsSync(out) ? fs.readdirSync(out).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(out, f), "utf8"))) : [];
  fs.rmSync(dir, { recursive: true, force: true });
  const spent = Number((/費用 \$([\d.]+)/.exec(r.stdout) ?? [])[1]);
  return { r, recs, spent };
}

test("料金表 lib/api-prices.json：公式の料金表（2026-11-11 に品質も確かめた）と同じ", () => {
  // https://platform.claude.com/docs/en/about-claude/pricing を 2026-11-11 に品質が読んだ値
  assert.deepEqual(prices.models, {
    "claude-opus-5-5": { input: 4, output: 20 },
    "claude-sonnet-5-5": { input: 2, output: 10 },
    "claude-haiku-5-5": { input: 0.1, output: 0.5, long: { threshold: 100000, input: 0.5, output: 2.5 } },
    "claude-opus-5": { input: 5, output: 25 },
    "claude-sonnet-5": { input: 2, output: 10 },
    "claude-haiku-4-5": { input: 1, output: 5 },
  });
  for (const [m, p] of Object.entries(prices.models)) assert.ok(p.output >= p.input && p.input > 0, m);
  // 既定モデル（lib/claude.ts）とランナーで使うモデルは料金表にある
  const model = /export const MODEL = "([^"]+)"/.exec(fs.readFileSync(path.join(ROOT, "lib/claude.ts"), "utf8"))[1];
  assert.ok(prices.models[model], model);
});

// 既定モデル（lib/claude.ts）と料金表から、1 回の費用を計算する（モデルが変わってもテストを書き換えない）
const DEFAULT_MODEL = /export const MODEL = "([^"]+)"/.exec(fs.readFileSync(path.join(ROOT, "lib/claude.ts"), "utf8"))[1];
const P = prices.models[DEFAULT_MODEL];
const callUsd = (inTok, outTok) => (inTok * P.input + outTok * P.output) / 1e6;
const PER_CALL = callUsd(5000, 16000); // 偽の readRx：入力 5,000・出力 16,000（max_tokens いっぱい）
/** ランナーが止まった行「使った $a、次の 1 回の最悪 $b」 */
const stopLine = (stdout) => { const m = /使った \$([\d.]+)、次の 1 回の最悪 \$([\d.]+)/.exec(stdout); return m ? { used: Number(m[1]), next: Number(m[2]) } : null; };

test("上限：毎回 max_tokens いっぱい出力しても、使った額は --max-usd を超えない。止まるのは「使った額＋次の 1 回の最悪」が上限を超えるとき（既定モデルの料金で計算）", { skip: !tsOk && "Node の TypeScript 読み込みが無い" }, (t) => {
  const maxUsd = Number((PER_CALL * 2.5).toFixed(4)); // 2 回は呼べ、3 回目の最悪は入らない上限
  const { r, recs, spent } = run({ maxUsd });
  t.diagnostic(`既定モデル ${DEFAULT_MODEL}：1 回 $${PER_CALL.toFixed(4)}、上限 $${maxUsd}、呼んだ ${recs.length} 回、使った $${spent}`);
  assert.equal(r.status, 0, r.stderr.slice(0, 300));
  assert.ok(spent <= maxUsd, `spent=${spent}`);
  assert.ok(recs.length >= 1);
  for (const x of recs) assert.equal(x.cost_usd, Number(PER_CALL.toFixed(6)), "1 回の費用＝料金表 × 偽の使用量");
  assert.ok(Math.abs(spent - recs.length * PER_CALL) < 1e-4);
  const s = stopLine(r.stdout);
  assert.ok(s, "上限で止まった行が無い");
  assert.ok(s.used + s.next > maxUsd, "止まったのは次の 1 回で上限を超えうるから");
  assert.ok(s.next >= PER_CALL - 1e-4, "次の 1 回の最悪は、実際の 1 回の費用以上");
  // 最悪の見積もり（≥ 1 回の費用）で数えるので、呼ぶ回数は 上限 ÷ 1 回の費用 を超えない
  assert.ok(recs.length <= Math.floor(maxUsd / PER_CALL));
});

test("上限：例外で失敗した回は最悪の費用で数え、それでも上限を超える前に止まる（既定モデルの料金で計算）", { skip: !tsOk && "Node の TypeScript 読み込みが無い" }, () => {
  const maxUsd = Number((PER_CALL * 2.5).toFixed(4));
  const { r, recs, spent } = run({ maxUsd, fake: "throw" });
  assert.equal(r.status, 0, r.stderr.slice(0, 300));
  assert.ok(recs.length >= 1);
  assert.ok(recs.every((x) => x.error && x.cost_reserved_usd >= PER_CALL - 1e-4), "失敗した回は 1 回の最悪の費用以上で数える");
  assert.ok(spent <= maxUsd, `spent=${spent}`);
  const s = stopLine(r.stdout);
  assert.ok(s && s.used + s.next > maxUsd);
});

test("上限が 1 回の最悪の費用より小さければ 1 回も呼ばない（既定モデルの料金で計算）", { skip: !tsOk && "Node の TypeScript 読み込みが無い" }, () => {
  const { recs, spent } = run({ maxUsd: Number((PER_CALL * 0.5).toFixed(4)) });
  assert.equal(recs.length, 0);
  assert.equal(spent, 0);
});

test("上限：モデルを明示しても同じ決まり（Opus 5.5 で $1 → 2 回、1 回 $0.34）", { skip: !tsOk && "Node の TypeScript 読み込みが無い" }, () => {
  const { r, recs, spent } = run({ maxUsd: 1, model: "claude-opus-5-5" });
  assert.equal(r.status, 0, r.stderr.slice(0, 300));
  assert.equal(recs.length, 2);
  assert.equal(recs[0].cost_usd, 0.34);
  assert.ok(spent <= 1);
});

test("Haiku 5.5：料金表のとおりの安い料金で数える（10 万トークン以下）", { skip: !tsOk && "Node の TypeScript 読み込みが無い" }, () => {
  const { recs } = run({ n: 1, maxUsd: 1, model: "claude-haiku-5-5" });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].cost_usd, (5000 * 0.1 + 16000 * 0.5) / 1e6);
});

test("直った：入力が見積もり（画像 幅×高さ÷750 ＋ 文字 2,000、×1.3）より多くても、2 回目からは実際の入力の最大で取っておくので上限を超えない", { skip: !tsOk && "Node の TypeScript 読み込みが無い" }, () => {
  // 1 回 入力 20,000 トークン（見積もり約 5,600 の 3.6 倍）・出力 16,000：$0.40／回。上限 $0.75 なら 1 回で止まるべき
  const { recs, spent } = run({ maxUsd: 0.75, input: 20000 });
  assert.ok(spent <= 0.75, `spent=${spent}（${recs.length} 回）`);
});
