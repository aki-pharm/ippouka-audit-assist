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
const GAP = 0.15; // ナレーションの後ろに足す間（秒）
const TMP = "captures/tmp"; fs.mkdirSync(TMP, { recursive: true });
const PARTS = "captures/parts-v2"; fs.rmSync(PARTS, { recursive: true, force: true }); fs.mkdirSync(PARTS, { recursive: true });
const PH = (n) => `captures/photos/${n}.jpg`;
const markers = Object.fromEntries(JSON.parse(fs.readFileSync("captures/app/markers-rel.json", "utf8")).map((m) => [m.name, m.s]));
const dur = (f) => +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString();
const appDur = dur("captures/app/app.mp4");
const nar = (key) => { const f = `captures/narration/${key}.wav`; return fs.existsSync(f) ? { file: f, dur: dur(f) } : null; };
const live = (name) => { const f = `captures/live/${name}.mp4`; return fs.existsSync(f) ? f : null; };

function esc(t) { return t.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/%/g, "\\%").replace(/\[/g, "\\[").replace(/\]/g, "\\]"); }
function sub(text) { return `drawbox=x=0:y=ih-150:w=iw:h=150:color=black@0.45:t=fill,drawtext=fontfile=${FONT}:text='${esc(text)}':fontsize=58:fontcolor=white:borderw=3:bordercolor=black@0.6:x=(w-text_w)/2:y=h-112`; }
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
  { id: "02", name: "実写_監査の手元", kind: "live", live: "audit", placeholder: "【実写】監査している手元（11/4 撮影）" },
  { id: "03", name: "一包化とは", kind: "clip", src: "captures/anim/ippouka.mp4", minDur: 4.9, maxDur: 8 },
  { id: "05", name: "120包", kind: "clip", src: "captures/anim/problem.mp4", minDur: 9, maxDur: 10.3 },
  { id: "06", name: "1包目が基準", kind: "clip", src: "captures/anim/firstbag.mp4", minDur: 7.5 },
  { id: "04", name: "問いかけ_白い錠剤3つ", kind: "clip", src: "captures/anim/intro.mp4", minDur: 8, maxDur: 10 },
  { id: "07", name: "新人", kind: "clip", src: "captures/anim/newbie.mp4" },
  { id: "08", name: "会社違いの錠剤", kind: "clip", src: "captures/anim/variety.mp4", fixed: 4.2 },
  { id: "10a", name: "タイトル_作ったもの", kind: "clip", src: "captures/anim/title.mp4", minDur: 4.6 },
  { id: "11", name: "処方箋を撮る_アプリ_読み取り_表", kind: "seq", items: [{ live: "shoot", len: 3.0 }, { app: markers.read_click - 0.3, len: 2.2, zoom: [120, 900] }, { app: markers.review - 0.3, len: 99, zoom: [120, 900] }], sub: "処方箋の写真 → Claude が表に（下書き。手で直せる）" },
  { id: "13", name: "アプリ_イメージ図", kind: "app", from: markers.bags, zoom: [160, 900], sub: "似た錠剤に同じ印。ルールで判定、AIには判定させない" },
  { id: "14a", name: "実写_図と袋を見比べる", kind: "live", live: "compare", placeholder: "【実写】アプリの図と袋を見比べる手元（11/4 撮影）" },
  { id: "14b", name: "実写_裏返すアップ_アムロジピンに印", kind: "seq", items: [{ live: "flip", len: 3.9 }, { still: "captures/flip-annotated.png", len: 9 }], fixed: 8 },
  { id: "15a", name: "アプリ_情報カード", kind: "app", from: markers.info_card, zoom: [140, 900] },
  { id: "15b", name: "添付文書PDF_性状の表に寄る", kind: "seq", items: [{ still: "captures/pdf-dox.png", len: 1.6 }, { still: "captures/pdf-dox-table.png", len: 9 }] },
  { id: "10", name: "なぜカメラで判定しないのか", kind: "clip", src: "captures/anim/why.mp4", minDur: 25.4 },
  { id: "16", name: "Claudeの3場面", kind: "clip", src: "captures/anim/claude3.mp4", minDur: 8.0 },
  { id: "17", name: "確認の記録_チャットとマスタ", kind: "seq", items: [{ still: "captures/chat-verify.jpg", len: 4.6 }, { live: "github", len: 9 }], sub: "写真を貼って1つずつ確認 → 28品目のマスタ（確認者・確認日つき）" },
  { id: "18", name: "広がる", kind: "clip", src: "captures/anim/spread.mp4", minDur: 5.5 },
  { id: "20a", name: "実写_スマホを持つ手", kind: "live", live: "phone", placeholder: "【実写/写真】アプリを開いたスマホを持つ手（11/4 撮影）" },
  { id: "20", name: "締め", kind: "clip", src: "captures/anim/closing-short.mp4", minDur: 10.2 },
];

const BLUR_BG = `split[bg][fg];[bg]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=30:5,eq=brightness=-0.15[bg2];[fg]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg2];[bg2][fg2]overlay=(W-w)/2:(H-h)/2`;

/** アプリ録画（780×1688）の y0 から h px を切り出して高さ 1080 に拡大。両脇は同じ画面をぼかして敷く */
const APP_ZOOM = (y0, h) => `split[bg][fg];[bg]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=30:5,eq=brightness=-0.2[bg2];[fg]crop=780:${h}:0:${y0},scale=-2:${H}[fg2];[bg2][fg2]overlay=(W-w)/2:0`;

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
    if (c.zoom) vf.push(APP_ZOOM(c.zoom[0], c.zoom[1]));
    else vf.push(`scale=-2:880`, `pad=${W}:${H}:(ow-iw)/2:40:color=${BG}`);
  } else if (kind === "seq") {
    // 実写とアプリ録画を順につなぐ（それぞれ 1920×1080 の無音セグメントにしてから連結）
    const segs = c.items.map((it, k) => {
      const f = path.join(TMP, `seg${i}_${k}.mp4`);
      if (it.live) {
        const src = live(it.live);
        if (!src) return null;
        run(["-t", String(it.len), "-i", src, "-filter_complex", `[0:v]${BLUR_BG},fps=${FPS},format=yuv420p[v]`, "-map", "[v]", "-c:v", "libx264", "-crf", "20", "-an", f]);
      } else if (it.still) {
        run(["-loop", "1", "-t", String(it.len), "-i", it.still, "-vf", `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${BG},fps=${FPS},format=yuv420p`, "-c:v", "libx264", "-crf", "20", "-an", f]);
      } else {
        const zf = it.zoom ? APP_ZOOM(it.zoom[0], it.zoom[1]) : `scale=-2:880,pad=${W}:${H}:(ow-iw)/2:40:color=${BG}`;
        run(["-ss", String(it.app), "-t", String(Math.min(it.len, appDur - it.app)), "-i", "captures/app/app.mp4", "-filter_complex", `[0:v]${zf},fps=${FPS},format=yuv420p[v]`, "-map", "[v]", "-c:v", "libx264", "-crf", "20", "-an", f]);
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
const joinedAll = path.join(TMP, "all.mp4");
run(["-f", "concat", "-safe", "0", "-i", path.join(TMP, "list.txt"), "-c", "copy", joinedAll]);
// BGM（captures/bgm/bgm.mp3 があれば）：小さく敷き、ナレーションが鳴っている間は自動で下げる（sidechain）。最後はフェードアウト
const BGM = "captures/bgm/bgm.mp3";
if (fs.existsSync(BGM)) {
  const T = total;
  run(["-i", joinedAll, "-stream_loop", "-1", "-i", BGM, "-filter_complex",
    `[1:a]volume=0.16,afade=t=in:d=2,afade=t=out:st=${(T - 4).toFixed(2)}:d=4,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[bg];[0:a]asplit=2[nar][sc];[bg][sc]sidechaincompress=threshold=0.015:ratio=8:attack=40:release=700:makeup=1[bgd];[nar][bgd]amix=inputs=2:duration=first:normalize=0[a]`,
    "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", String(T), OUT]);
  console.log("BGM を混ぜた:", BGM);
} else fs.copyFileSync(joinedAll, OUT);
console.log(`書き出し: ${OUT}（${Math.floor(total / 60)}分${Math.round(total % 60)}秒）／カット別: ${PARTS}/`);
