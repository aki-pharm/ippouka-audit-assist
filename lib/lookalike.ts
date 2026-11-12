/**
 * 見分け注意（同じ袋で取り違えやすい錠剤の組）の決まり。React・マスタに依存しない純粋な関数。
 * 形が同じ・色が近い・長径（楕円・長円は短径も）が近い・厚さが近い、のすべてを満たす組を「似ている」とする。
 * 大きさ・厚さが分からない欄は、その欄では外さない（分からないまま「似ていない」にはしない）。
 * 決まりの数値（LOOKALIKE_PARAMS）は scripts/eval/lookalike.cjs で data/lookalike-pairs.json の組から選んだ。
 */

export type LookalikeParams = {
  /** 長径（丸は直径）の差の上限 mm */
  maxLongDiff: number;
  /** 短径の差の上限 mm（楕円・長円だけ） */
  maxShortDiff: number;
  /** 厚さの差の上限 mm */
  maxThickDiff: number;
  /** 色の差（CIE76 の ΔE）の上限 */
  maxColorDelta: number;
};

/**
 * 既定の数値。scripts/eval/lookalike.cjs で割合のいちばん低い数値（長径 1.0・厚さ 0.7）は拾いたい組の差にちょうど乗っていたので、
 * 安全のため長径 +0.2mm・厚さ +0.1mm の余裕を足した（品質 8a1c3b3）。短径・ΔE はそのまま
 */
export const LOOKALIKE_PARAMS: LookalikeParams = { maxLongDiff: 1.2, maxShortDiff: 0.5, maxThickDiff: 0.8, maxColorDelta: 16 };

export type Look = {
  shape: string | null | undefined;
  color: string | null | undefined;
  size_long_mm?: number | null;
  size_short_mm?: number | null;
  thickness_mm?: number | null;
};

type RGB = [number, number, number];

const HUES: [RegExp, RGB][] = [
  [/^(だいだい|橙)/, [240, 150, 50]],
  [/^(ピンク|桃)/, [240, 160, 180]],
  [/^紅/, [220, 60, 90]],
  [/^赤/, [220, 60, 50]],
  [/^黄/, [240, 210, 60]],
  [/^(褐|茶)/, [150, 95, 50]],
  [/^青/, [70, 110, 210]],
  [/^緑/, [80, 160, 80]],
  [/^紫/, [140, 90, 180]],
  [/^灰/, [150, 150, 150]],
  [/^黒/, [40, 40, 40]],
  [/^白/, [255, 255, 255]],
];
const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];

const mix = (a: RGB, b: RGB, w: number): RGB => [0, 1, 2].map((i) => a[i] * (1 - w) + b[i] * w) as RGB;

/** 色の 1 つの言い方（範囲の片方）を RGB に。色の語が無ければ null */
function parseOne(text: string): RGB | null {
  let s = text;
  // 全体の明るさ（先頭の修飾）
  let lighten = 0;
  let darken = 0;
  const pre = s.match(/^(ごくうすい|ごく淡い|極淡|うすい|薄い|淡い|うす|淡|明るい|くすんだ|濃い|濃|暗い|暗|類)/);
  if (pre) {
    const w = pre[1];
    if (/^(ごくうすい|ごく淡い|極淡)/.test(w)) lighten = 0.7;
    else if (/^(うすい|薄い|淡い|うす|淡)/.test(w)) lighten = 0.5;
    else if (w === "明るい") lighten = 0.3;
    else if (w === "類") lighten = 0.8;
    else if (w === "くすんだ") darken = 0.2;
    else darken = 0.3;
    s = s.slice(w.length);
  }
  // 色の語を順に拾う。最後の色が本体、前の色は色み（微＝0.15、帯＝0.18、淡＝0.2、それ以外＝0.35）
  const hues: { rgb: RGB; w: number; mod: string | null }[] = [];
  let tint = 0.35;
  let modName: string | null = null;
  while (s.length) {
    const mod = s.match(/^(微|帯|淡|うすい)/);
    if (mod) {
      tint = mod[1] === "微" ? 0.15 : mod[1] === "帯" ? 0.18 : 0.2;
      modName = mod[1];
      s = s.slice(mod[1].length);
      continue;
    }
    const h = HUES.find(([re]) => re.test(s));
    if (h) {
      hues.push({ rgb: h[1], w: tint, mod: modName });
      tint = 0.35;
      modName = null;
      s = s.slice(s.match(h[0])![0].length);
      continue;
    }
    if (/^(み|味|の|色|系|がかった|がかる)/.test(s)) {
      s = s.slice(1);
      continue;
    }
    break; // 色の語が終わった（「素錠」「フィルムコーティング錠」など）
  }
  if (!hues.length) return null;
  // 本体の色に「微」「帯」「淡」がつけば、白に少しその色（「微黄色」は白に近い黄）
  const last = hues[hues.length - 1];
  const MAIN_W: Record<string, number> = { 微: 0.25, 帯: 0.35, 淡: 0.5, うすい: 0.5 };
  let rgb = last.mod ? mix(WHITE, last.rgb, MAIN_W[last.mod]) : last.rgb;
  for (const h of hues.slice(0, -1)) rgb = mix(rgb, h.rgb, h.w);
  if (lighten) rgb = mix(rgb, WHITE, lighten);
  if (darken) rgb = mix(rgb, BLACK, darken);
  return rgb;
}

/** 添付文書の色の言い方を、範囲の両端の色と斑点の有無に分ける。「白色～微黄白色」→ 2 色。読めなければ null */
export function parseColor(text: string | null | undefined): { ends: RGB[]; speckled: boolean } | null {
  if (!text || text === "未確認") return null;
  const n = text.normalize("NFKC").replace(/[\s　]/g, "");
  const speckled = /斑点|まだら|斑/.test(n);
  const main = n.replace(/[（(].*$/, "");
  const ends = main
    .split(/[～〜~]|から/)
    .map(parseOne)
    .filter((x): x is RGB => !!x);
  return ends.length ? { ends, speckled } : null;
}

function toLab([r, g, b]: RGB): [number, number, number] {
  const lin = (c: number) => {
    const v = c / 255;
    return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92;
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/**
 * 2 つの色の言い方の差（ΔE）。範囲のある色は、いちばん近い端どうしで比べる（取り違えを見落とさない側に倒す）。
 * 片方だけ斑点があれば Infinity（斑点で見分けられる）。読めない色は null
 */
export function colorDelta(a: string | null | undefined, b: string | null | undefined): number | null {
  const pa = parseColor(a);
  const pb = parseColor(b);
  if (!pa || !pb) return null;
  if (pa.speckled !== pb.speckled) return Infinity;
  let best = Infinity;
  for (const x of pa.ends)
    for (const y of pb.ends) {
      const [l1, a1, b1] = toLab(x);
      const [l2, a2, b2] = toLab(y);
      best = Math.min(best, Math.hypot(l1 - l2, a1 - a2, b1 - b2));
    }
  return best;
}

const near = (x: number | null | undefined, y: number | null | undefined, max: number) => x == null || y == null || Math.abs(x - y) <= max + 1e-9;

/** 2 つの錠剤が見分け注意か。理由（どの欄で外れたか）も返す */
export function lookAlike(a: Look, b: Look, p: LookalikeParams = LOOKALIKE_PARAMS): { similar: boolean; why: string } {
  if (!a.shape || a.shape !== b.shape) return { similar: false, why: "形が違う" };
  // 読めない色の言い方は、同じ言い方どうしだけ同じ色とみなす
  const raw = (c: string | null | undefined) => (c ?? "").normalize("NFKC").replace(/[\s　]/g, "");
  const d = colorDelta(a.color, b.color) ?? (raw(a.color) && raw(a.color) !== "未確認" && raw(a.color) === raw(b.color) ? 0 : null);
  if (d == null) return { similar: false, why: "色が分からない" };
  if (d > p.maxColorDelta) return { similar: false, why: d === Infinity ? "斑点の有無が違う" : `色が違う（ΔE ${d.toFixed(1)}）` };
  if (!near(a.size_long_mm, b.size_long_mm, p.maxLongDiff)) return { similar: false, why: "長径が違う" };
  if (a.shape !== "round" && !near(a.size_short_mm, b.size_short_mm, p.maxShortDiff)) return { similar: false, why: "短径が違う" };
  if (!near(a.thickness_mm, b.thickness_mm, p.maxThickDiff)) return { similar: false, why: "厚さが違う" };
  return { similar: true, why: "形・色・大きさ・厚さが近い" };
}
