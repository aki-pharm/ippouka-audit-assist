/**
 * デモ動画を ffmpeg で組み立てる（1920×1080、30fps、字幕焼き込み、ナレーション同期）。
 *   node scripts/make-video.cjs [out.mp4]
 * 入力（captures/ は gitignore。写真・録画・音声・動画はコミットしない）：
 *   captures/anim/*.mp4          アニメーション（scripts/make-intro.cjs）
 *   docs/demo/slides/*.png       文字スライド（scripts/make-slides.cjs）
 *   captures/photos/*.jpg        錠剤の写真（AKI撮影）
 *   captures/live/*.mp4          実写（AKI撮影）。無ければ仮の絵（黒地に説明文）
 *   captures/app/app.mp4         アプリの画面録画と markers-rel.json
 *   captures/pdf-dox.png         添付文書の1ページ目
 *   captures/narration/NN.wav    ナレーション（カット番号ごと。無ければ無音で絵コンテの秒数）
 * 出力：1本の動画と、カットごとのファイル（音声つき、尺調整ずみ）captures/parts-v2/
 * 構成は docs/demo/storyboard.md（v2）の再生順。
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const OUT = process.argv[2] || "captures/demo-v2.mp4";
const W = 1920, H = 1080, FPS = 30;
const FONT = "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf";
const BG = "0x0B1220";
const GAP = 0.2; // ナレーションの後ろに足す間（秒）
const TMP = "captures/tmp"; fs.mkdirSync(TMP, { recursive: true });
const PARTS = "captures/parts-v2"; fs.rmSync(PARTS, { recursive: true, force: true }); fs.mkdirSync(PARTS, { recursive: true });
const PH = (n) => `captures/photos/${n}.jpg`;
const markers = Object.fromEntries(JSON.parse(fs.readFileSync("captures/app/markers-rel.json", "utf8")).map((m) => [m.name, m.s]));
const dur = (f) => +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString();
const appDur = dur("captures/app/app.mp4");
const nar = (key) => { const f = `captures/narration/${key}.wav`; return fs.existsSync(f) ? { file: f, dur: dur(f) } : null; };
const live = (name) => { const f = `captures/live/${name}.mp4`; return fs.existsSync(f) ? f : null; };

function esc(t) { return t.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/%/g, "\\%").replace(/\[/g, "\\[").replace(/\]/g, "\\]"); }
function sub(text) { return `drawtext=fontfile=${FONT}:text='${esc(text)}':fontsize=44:fontcolor=white:borderw=3:bordercolor=black@0.8:x=(w-text_w)/2:y=h-100`; }
function placeholderText(text) { return `drawtext=fontfile=${FONT}:text='${esc(text)}':fontsize=56:fontcolor=0xCBD5E1:x=(w-text_w)/2:y=(h-text_h)/2`; }

/**
 * カット定義。id は絵コンテの番号（音声ファイル名）。kind：
 *   clip        アニメ（最後のコマで止めて尺を合わせる）
 *   still/photo 静止画（photo は縦横比を保って中央に）
 *   app         アプリ録画の一部 {from}（縦長を中央に）
 *   app2        アプリ録画の2区間をつなぐ {ranges:[[from,len],[from,len]]}（読み取りの待ち時間を飛ばす）
 *   live        実写 captures/live/<name>.mp4。無ければ仮の絵（placeholder の文）
 * minDur：アニメの動きが終わるまでの最短秒数。sub：字幕（アニメは中に文字があるので省略）
 */
const CUTS = [
  { id: "01", name: "挨拶", kind: "clip", src: "captures/anim/greeting.mp4", minDur: 6 },
  { id: "02", name: "実写_監査の手元", kind: "live", live: "audit", placeholder: "【実写】監査している手元（11/4 撮影）", sub: "とくに手間のかかる作業、一包化" },
  { id: "03", name: "一包化とは", kind: "clip", src: "captures/anim/ippouka.mp4", minDur: 5.2, maxDur: 8 },
  { id: "05", name: "120包", kind: "clip", src: "captures/anim/problem.mp4", minDur: 9, maxDur: 10.3 },
  { id: "06", name: "1包目が基準", kind: "clip", src: "captures/anim/firstbag.mp4", minDur: 8.2 },
  { id: "04", name: "問いかけ_白い錠剤3つ", kind: "clip", src: "captures/anim/intro.mp4", minDur: 8, maxDur: 10 },
  { id: "07", name: "新人", kind: "clip", src: "captures/anim/newbie.mp4", minDur: 5 },
  { id: "08", name: "会社違いの錠剤", kind: "clip", src: "captures/anim/variety.mp4", minDur: 6 },
  { id: "10a", name: "タイトル_作ったもの", kind: "still", src: "docs/demo/slides/03-solution.png" },
  { id: "10", name: "なぜカメラで判定しないのか", kind: "clip", src: "captures/anim/why.mp4", minDur: 14 },
  { id: "11", name: "処方箋を撮る_アプリ_読み取り_表", kind: "seq", items: [{ live: "shoot", len: 3.0 }, { app: markers.read_click - 0.3, len: 2.2 }, { app: markers.review - 0.3, len: 99 }], sub: "処方箋を撮ると Claude が表に。読み取りは下書き、手で直せる" },
  { id: "13", name: "アプリ_イメージ図", kind: "app", from: markers.bags, sub: "見分け注意：似た錠剤は刻印で区別（ルールで判定。AIに判定させない）" },
  { id: "14a", name: "実写_図と袋を見比べる", kind: "live", live: "compare", placeholder: "【実写】アプリの図と袋を見比べる手元（11/4 撮影）", sub: "図と実物を見比べる" },
  { id: "14b", name: "実写_裏返すアップ", kind: "live", live: "flip", placeholder: "【実写】白い錠剤を裏返すアップ（11/4 撮影）", fallback: PH(3), sub: "ドキサゾシン Tw141 のはずが、アムロジピン t 1" },
  { id: "15a", name: "アプリ_情報カード", kind: "app", from: markers.info_card, sub: "根拠は公的文書の添付文書" },
  { id: "15b", name: "添付文書PDF", kind: "photo", src: "captures/pdf-dox.png", sub: "PMDA の PDF がそのまま開く" },
  { id: "16", name: "Claudeの3場面", kind: "clip", src: "captures/anim/claude3.mp4", minDur: 8.5 },
  { id: "17", name: "写真_確認した錠剤", kind: "photo", src: PH(6), sub: "薬剤師自身が添付文書と実物に1つずつ突き合わせて確認" },
  { id: "18", name: "広がる", kind: "clip", src: "captures/anim/spread.mp4", minDur: 6.2 },
  { id: "20a", name: "実写_スマホを持つ手", kind: "live", live: "phone", placeholder: "【実写/写真】アプリを開いたスマホを持つ手（11/4 撮影）", sub: "判断するのは薬剤師。アプリは調べる手間を減らす道具。大きな機械はいらない" },
  { id: "20", name: "締め", kind: "clip", src: "captures/anim/closing-short.mp4", minDur: 10 },
];

const BLUR_BG = `split[bg][fg];[bg]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=30:5,eq=brightness=-0.15[bg2];[fg]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg2];[bg2][fg2]overlay=(W-w)/2:(H-h)/2`;

function run(args) { execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" }); }

const parts = [];
let total = 0;
CUTS.filter((c) => !(c.optional && !live(c.live))).forEach((c, i) => {
  const n = nar(c.id);
  let d = c.fixed ?? (n ? n.dur + GAP : 4);
  if (c.minDur) d = Math.max(d, c.minDur);
  if (c.maxDur && !n) d = Math.min(d, c.maxDur);
  if (c.maxDur && n) d = Math.max(n.dur + GAP, Math.min(d, c.maxDur));
  const out = path.join(TMP, `part${String(i).padStart(2, "0")}.mp4`);
  const vf = [];
  let input;
  let kind = c.kind;
  if (kind === "live") {
    const f = live(c.live);
    if (f) { input = ["-t", String(d), "-i", f]; kind = "livefile"; }
    else if (c.fallback) { input = ["-loop", "1", "-t", String(d), "-i", c.fallback]; kind = "photo"; }
    else { input = ["-f", "lavfi", "-t", String(d), "-i", `color=c=${BG}:s=${W}x${H}:r=${FPS}`]; kind = "placeholder"; vf.push(placeholderText(c.placeholder)); }
  }
  if (kind === "app") {
    input = ["-ss", String(Math.max(0, Math.min(c.from, appDur - d))), "-t", String(d), "-i", "captures/app/app.mp4"];
    vf.push(`scale=-2:880`, `pad=${W}:${H}:(ow-iw)/2:40:color=${BG}`);
  } else if (kind === "seq") {
    // 実写とアプリ録画を順につなぐ（それぞれ 1920×1080 の無音セグメントにしてから連結）
    const segs = c.items.map((it, k) => {
      const f = path.join(TMP, `seg${i}_${k}.mp4`);
      if (it.live) {
        const src = live(it.live);
        if (!src) return null;
        run(["-t", String(it.len), "-i", src, "-filter_complex", `[0:v]${BLUR_BG},fps=${FPS},format=yuv420p[v]`, "-map", "[v]", "-c:v", "libx264", "-crf", "20", "-an", f]);
      } else {
        run(["-ss", String(it.app), "-t", String(Math.min(it.len, appDur - it.app)), "-i", "captures/app/app.mp4", "-vf", `scale=-2:880,pad=${W}:${H}:(ow-iw)/2:40:color=${BG},fps=${FPS},format=yuv420p`, "-c:v", "libx264", "-crf", "20", "-an", f]);
      }
      return f;
    }).filter(Boolean);
    const list = path.join(TMP, `seg${i}.txt`); fs.writeFileSync(list, segs.map((s) => `file '${path.resolve(s)}'`).join("\n"));
    const joined = path.join(TMP, `seg${i}.mp4`); run(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", joined]);
    input = ["-t", String(d), "-i", joined];
    vf.push(`tpad=stop_mode=clone:stop_duration=${d}`);
  } else if (kind === "photo") {
    if (!input) input = ["-loop", "1", "-t", String(d), "-i", c.src];
    vf.push(`scale=${W}:${H}:force_original_aspect_ratio=decrease`, `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${BG}`);
  } else if (kind === "livefile") {
    // 縦の実写は中央に、両脇は同じ映像をぼかして敷く
    vf.push(BLUR_BG, `tpad=stop_mode=clone:stop_duration=${d}`);
  } else if (kind === "clip") {
    input = ["-t", String(d), "-i", c.src];
    vf.push(`tpad=stop_mode=clone:stop_duration=${d}`, `scale=${W}:${H}`);
  } else if (kind === "still") {
    input = ["-loop", "1", "-t", String(d), "-i", c.src];
    vf.push(`scale=${W}:${H}`);
  } else if (kind === "placeholder") {
    // input は上で設定済み
  }
  if (c.sub) vf.push(sub(c.sub));
  vf.push(`fps=${FPS}`, "format=yuv420p");
  const audio = n ? ["-i", n.file] : ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"];
  run([...input, ...audio, "-t", String(d), "-filter_complex", `[0:v]${vf.join(",")}[v]`, "-map", "[v]", "-map", "1:a", "-af", "apad", "-shortest", "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", out]);
  parts.push(out);
  const partName = `${String(i + 1).padStart(2, "0")}_${c.id}_${c.name}.mp4`;
  fs.copyFileSync(out, path.join(PARTS, partName));
  total += d;
  console.log(`${partName}  ${d.toFixed(1)}s${n ? " 音声あり" : ""}${kind === "placeholder" ? " 仮" : ""}`);
});
fs.writeFileSync(path.join(TMP, "list.txt"), parts.map((p) => `file '${path.resolve(p)}'`).join("\n"));
run(["-f", "concat", "-safe", "0", "-i", path.join(TMP, "list.txt"), "-c", "copy", OUT]);
console.log(`書き出し: ${OUT}（${Math.floor(total / 60)}分${Math.round(total % 60)}秒）／カット別: ${PARTS}/`);
