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

test("上限：毎回 max_tokens いっぱい出力しても、使った額は --max-usd を超えない（$1 → 2 回で止まる）", { skip: !tsOk && "Node の TypeScript 読み込みが無い" }, () => {
  const { r, recs, spent } = run({ maxUsd: 1 });
  assert.equal(r.status, 0, r.stderr.slice(0, 300));
  assert.match(r.stdout, /上限 \$1 を超えうるので止める/);
  assert.equal(recs.length, 2);
  assert.ok(spent <= 1, `spent=${spent}`);
  // 1 回の費用は Opus 5.5 で 5,000×$4 + 16,000×$20（/100 万）＝ $0.34
  assert.equal(recs[0].cost_usd, 0.34);
});

test("上限：例外で失敗した回は最悪の費用で数え、それでも上限を超える前に止まる", { skip: !tsOk && "Node の TypeScript 読み込みが無い" }, () => {
  const { r, recs, spent } = run({ maxUsd: 1, fake: "throw" });
  assert.equal(r.status, 0, r.stderr.slice(0, 300));
  assert.equal(recs.length, 2);
  assert.ok(recs.every((x) => x.error && x.cost_reserved_usd > 0.3));
  assert.ok(spent <= 1 && spent > 0.6, `spent=${spent}`);
});

test("上限が 1 回の最悪の費用より小さければ 1 回も呼ばない", { skip: !tsOk && "Node の TypeScript 読み込みが無い" }, () => {
  const { recs, spent } = run({ maxUsd: 0.2 });
  assert.equal(recs.length, 0);
  assert.equal(spent, 0);
});

test("Haiku 5.5：料金表のとおりの安い料金で数える（10 万トークン以下）", { skip: !tsOk && "Node の TypeScript 読み込みが無い" }, () => {
  const { recs } = run({ n: 1, maxUsd: 1, model: "claude-haiku-5-5" });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].cost_usd, (5000 * 0.1 + 16000 * 0.5) / 1e6);
});

test("【不具合】入力が見積もり（画像 幅×高さ÷750 ＋ 文字 2,000、×1.3）より多いと、上限を超える（実際の入力から学ばない）", { todo: "最悪の費用を、それまでに実際に使った入力トークンの最大でも取っておくべき。docs の「上限は超えない」は入力の見積もりが当たっているときだけ", skip: !tsOk && "Node の TypeScript 読み込みが無い" }, () => {
  // 1 回 入力 20,000 トークン（見積もり約 5,600 の 3.6 倍）・出力 16,000：$0.40／回。上限 $0.75 なら 1 回で止まるべき
  const { recs, spent } = run({ maxUsd: 0.75, input: 20000 });
  assert.ok(spent <= 0.75, `spent=${spent}（${recs.length} 回）`);
});
