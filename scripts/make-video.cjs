/**
 * デモ動画のドラフトを ffmpeg で組み立てる（1920×1080、30fps、字幕焼き込み）。
 *   node scripts/make-video.cjs [out.mp4]
 * 入力（captures/ は gitignore。写真・録画はコミットしない）：
 *   docs/demo/slides/*.png      文字スライド（scripts/make-slides.cjs）
 *   captures/photos/*.jpg       錠剤の写真（AKI撮影）
 *   captures/app/app.mp4        アプリの画面録画（CDP screencast）と markers-rel.json
 *   captures/pdf-dox.png        添付文書の1ページ目（pdftoppm）
 *   captures/narration/NN.wav   ナレーション（VOICEVOX）。無ければ無音で、絵コンテの秒数を使う
 * 構成は docs/demo/storyboard.md の順。
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const OUT = process.argv[2] || "captures/demo-draft.mp4";
const W = 1920, H = 1080, FPS = 30;
const FONT = "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf";
const BG = "0x0F172A";
const TMP = "captures/tmp"; fs.mkdirSync(TMP, { recursive: true });
const PH = (n) => `captures/photos/${n}.jpg`;
const markers = Object.fromEntries(JSON.parse(fs.readFileSync("captures/app/markers-rel.json", "utf8")).map((m) => [m.name, m.s]));
const appDur = +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", "captures/app/app.mp4"]).toString();

function narration(n) {
  const f = `captures/narration/${String(n).padStart(2, "0")}.wav`;
  if (!fs.existsSync(f)) return null;
  return { file: f, dur: +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString() };
}

// 字幕（1カット1行）。drawtext 用にエスケープ
function sub(text) {
  const esc = text.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/%/g, "\\%");
  return `drawtext=fontfile=${FONT}:text='${esc}':fontsize=44:fontcolor=white:borderw=3:bordercolor=black@0.8:x=(w-text_w)/2:y=h-100`;
}

// 各カット：{kind, src, dur, sub, nar(ナレーション番号), from(録画の開始秒)}
const CUTS = [
  { kind: "still", src: "docs/demo/slides/01-opening.png", dur: 4, nar: 1, sub: "" },
  { kind: "photo", src: PH(4), dur: 5, sub: "この1包、処方どおりだと言い切れますか？" },
  { kind: "still", src: "docs/demo/slides/02-problem.png", dur: 24, nar: 2, sub: "" },
  { kind: "still", src: "docs/demo/slides/03-solution.png", dur: 11, nar: 3, sub: "" },
  { kind: "app", from: markers.sample_open - 1, dur: 5, sub: "処方箋の薬剤欄を撮る（デモは架空のサンプル）" },
  { kind: "app", from: markers.read_click, dur: 3, sub: "Claude が読み取り中…" },
  { kind: "app", from: markers.review, dur: 12, nar: 4, sub: "読み取り結果は下書き。すべて手で直せる" },
  { kind: "app", from: markers.select, dur: 7, nar: 5, sub: "別包・施設ルール・手巻きの印を反映" },
  { kind: "app", from: markers.bags, dur: 8, nar: 6, sub: "袋ごとのイメージ図。実寸比で並ぶ" },
  { kind: "app", from: markers.bag_evening, dur: 9, sub: "⚠ 見分け注意：形・色・大きさが近い。刻印で区別" },
  { kind: "photo", src: PH(5), dur: 5, nar: 7, sub: "図と見比べる。白い丸の1つ、刻印が違う" },
  { kind: "photo", src: PH(3), dur: 5, sub: "ドキサゾシン Tw141 のはずが、アムロジピン t 1" },
  { kind: "app", from: markers.info_card, dur: 5, nar: 8, sub: "錠剤をタップ → 登録情報。根拠の文言と改訂年月" },
  { kind: "photo", src: "captures/pdf-dox.png", dur: 8, sub: "添付文書（PMDA）の該当ページがそのまま開く" },
  { kind: "still", src: "docs/demo/slides/09-claude.png", dur: 22, nar: 9, sub: "" },
  { kind: "photo", src: PH(6), dur: 12, nar: 10, sub: "薬剤師が添付文書と実物に1つずつ突き合わせて確認" },
  { kind: "still", src: "docs/demo/slides/11-validation.png", dur: 9, nar: 11, sub: "" },
  { kind: "still", src: "docs/demo/slides/12-closing.png", dur: 9, nar: 12, sub: "" },
];

function run(args) { execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" }); }

const parts = [];
CUTS.forEach((c, i) => {
  const nar = c.nar ? narration(c.nar) : null;
  const dur = nar ? Math.max(c.dur, nar.dur + 0.8) : c.dur;
  const out = path.join(TMP, `part${String(i).padStart(2, "0")}.mp4`);
  const vf = [];
  if (c.kind === "app") {
    // 縦長の録画を中央に。高さ 1000px、両脇は背景色
    vf.push(`scale=-2:880`, `pad=${W}:${H}:(ow-iw)/2:40:color=${BG}`);
  } else if (c.kind === "photo") {
    vf.push(`scale=${W}:${H}:force_original_aspect_ratio=decrease`, `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${BG}`);
  } else {
    vf.push(`scale=${W}:${H}`);
  }
  if (c.sub) vf.push(sub(c.sub));
  vf.push(`fps=${FPS}`, "format=yuv420p");
  const audio = nar ? ["-i", nar.file] : ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"];
  const input = c.kind === "app"
    ? ["-ss", String(Math.max(0, Math.min(c.from, appDur - dur))), "-t", String(dur), "-i", "captures/app/app.mp4"]
    : ["-loop", "1", "-t", String(dur), "-i", c.src];
  run([...input, ...audio, "-t", String(dur), "-vf", vf.join(","), "-af", "apad", "-shortest", "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", out]);
  parts.push(out);
  console.log(`cut ${i + 1}/${CUTS.length} ${c.kind} ${dur.toFixed(1)}s${nar ? " +ナレーション" : ""}`);
});
fs.writeFileSync(path.join(TMP, "list.txt"), parts.map((p) => `file '${path.resolve(p)}'`).join("\n"));
run(["-f", "concat", "-safe", "0", "-i", path.join(TMP, "list.txt"), "-c", "copy", OUT]);
const total = +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", OUT]).toString();
console.log(`書き出し: ${OUT}（${Math.round(total)}秒）`);
