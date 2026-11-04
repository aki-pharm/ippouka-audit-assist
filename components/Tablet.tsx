import type { Tablet } from "@/lib/types";
import { UNVERIFIED } from "@/lib/types";
import { colorToHex } from "@/lib/color";

/** 1mm あたりの px。すべての錠剤を同じ縮尺で描く */
export const PX_PER_MM = 7;

const DEFAULT_SIZE: Record<string, [number, number]> = {
  round: [8, 8],
  oval: [11, 6],
  oblong: [13, 6],
  other: [9, 9],
};

/** 刻印の文字と、錠剤の中に収まるかどうか（全角は1.0、半角は0.6文字幅として概算） */
export function imprintLayout(tablet: Tablet | undefined, face: "front" | "back" = "front") {
  const shape = tablet?.shape ?? "other";
  const sizeKnown = tablet?.size_long_mm != null && tablet?.size_short_mm != null;
  const [dl, ds] = DEFAULT_SIZE[shape] ?? DEFAULT_SIZE.other;
  const long = (sizeKnown ? tablet!.size_long_mm! : dl) * PX_PER_MM;
  const short = (sizeKnown ? tablet!.size_short_mm! : ds) * PX_PER_MM;
  const imprint = face === "front" ? tablet?.imprint_front : tablet?.imprint_back;
  const fontSize = Math.max(9, Math.min(13, short / 3));
  const label = !tablet ? "?" : imprint === UNVERIFIED ? "未確認" : imprint === "なし" ? "" : imprint ?? "";
  const width = (t: string, fs: number) => [...t].reduce((acc, ch) => acc + (ch.charCodeAt(0) > 0xff ? 1 : 0.6), 0) * fs;
  const textWidth = width(label, fontSize);
  // 1行で収まるか。収まらなければ、少し小さい文字で最大3行に折り返して錠剤の中に入るか試す（実物の印字も2〜3段が多い）
  let lines: string[] = [label];
  let inside = textWidth <= long - 6;
  let fs = fontSize;
  if (!inside && label) {
    for (const fs2 of [Math.min(fontSize, 11), 10, 9]) {
      const wrapped = wrapImprint(label, long - 6, fs2, width);
      if (wrapped && wrapped.length <= 3 && wrapped.length * fs2 * 1.1 <= short - 4) {
        lines = wrapped;
        inside = true;
        fs = fs2;
        break;
      }
    }
  }
  return { label, inside, lines, fontSize: fs, textWidth, unverified: imprint === UNVERIFIED };
}

/** 刻印を幅に収まるように折り返す。空白で区切り、長い語は文字単位で分ける。収まらなければ null */
function wrapImprint(label: string, maxW: number, fs: number, width: (t: string, fs: number) => number): string[] | null {
  const lines: string[] = [];
  let cur = "";
  for (const word of label.split(" ")) {
    // 長い語は、できるだけ同じ長さに分ける（「オルケディア」→「オルケ」「ディア」）
    const chars = [...word];
    const k = Math.max(1, Math.ceil(width(word, fs) / maxW));
    const size = Math.ceil(chars.length / k);
    const chunks: string[] = [];
    for (let i = 0; i < chars.length; i += size) chunks.push(chars.slice(i, i + size).join(""));
    if (chunks.some((c) => width(c, fs) > maxW)) return null;
    for (const c of chunks) {
      if (cur && width(cur + " " + c, fs) <= maxW) cur = cur + " " + c;
      else {
        if (cur) lines.push(cur);
        cur = c;
      }
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** 錠剤イラスト（SVG）。形・色・大きさ・刻印をマスタから描く */
export function TabletSvg({
  tablet,
  face = "front",
  highlight = false,
  caption = true,
}: {
  tablet: Tablet | undefined;
  face?: "front" | "back";
  highlight?: boolean;
  /** 刻印が錠剤に収まらないとき、文字を錠剤の下に添えるか（複数個並べるときは親が1回だけ出す） */
  caption?: boolean;
}) {
  const shape = tablet?.shape ?? "other";
  const sizeKnown = tablet?.size_long_mm != null && tablet?.size_short_mm != null;
  const [dl, ds] = DEFAULT_SIZE[shape] ?? DEFAULT_SIZE.other;
  const long = (sizeKnown ? tablet!.size_long_mm! : dl) * PX_PER_MM;
  const short = (sizeKnown ? tablet!.size_short_mm! : ds) * PX_PER_MM;
  const fill = tablet?.color_hex ?? colorToHex(tablet?.color) ?? "#E5E7EB";
  const stroke = highlight ? "#B45309" : "#6B7280";
  const imprint = face === "front" ? tablet?.imprint_front : tablet?.imprint_back;
  const pad = 6;
  const w = long + pad * 2;
  const h = short + pad * 2;
  const cx = w / 2;
  const cy = h / 2;
  const dash = !sizeKnown || !tablet || tablet.status === "draft" ? "4 3" : undefined;

  let body;
  if (shape === "round") {
    body = <circle cx={cx} cy={cy} r={long / 2} fill={fill} stroke={stroke} strokeWidth={highlight ? 3 : 1.5} strokeDasharray={dash} />;
  } else if (shape === "oval") {
    body = <ellipse cx={cx} cy={cy} rx={long / 2} ry={short / 2} fill={fill} stroke={stroke} strokeWidth={highlight ? 3 : 1.5} strokeDasharray={dash} />;
  } else if (shape === "oblong") {
    body = (
      <rect x={pad} y={pad} width={long} height={short} rx={short / 2} fill={fill} stroke={stroke} strokeWidth={highlight ? 3 : 1.5} strokeDasharray={dash} />
    );
  } else {
    body = <rect x={pad} y={pad} width={long} height={short} rx={6} fill={fill} stroke={stroke} strokeWidth={highlight ? 3 : 1.5} strokeDasharray={dash} />;
  }

  // 文字が錠剤に収まるなら中に、収まらなければ下に添える（caption=false なら添えない）
  const { label: fullLabel, inside, lines, fontSize, textWidth } = imprintLayout(tablet, face);
  const label = inside || caption ? fullLabel : "";
  const captionH = label && !inside ? fontSize + 4 : 0;
  const totalH = h + captionH;
  const svgW = inside || !label ? w : Math.min(Math.max(w, textWidth + 12), 150);
  const offsetX = (svgW - w) / 2;
  const textColor = imprint === UNVERIFIED ? "#9CA3AF" : "#1F2937";

  return (
    <svg width={svgW} height={totalH} viewBox={`0 0 ${svgW} ${totalH}`} role="img" aria-label={tablet ? `${tablet.brand_name} の錠剤` : "未登録の錠剤"}>
      <g transform={`translate(${offsetX} 0)`}>
        {body}
        {tablet?.score_line && <line x1={cx} y1={cy - short / 2 + 2} x2={cx} y2={cy + short / 2 - 2} stroke="#9CA3AF" strokeWidth={1} />}
      </g>
      {label && inside && lines.length > 1 ? (
        // 2行で錠剤の中に描く（実物の印字も2段のことが多い）
        <text x={svgW / 2} textAnchor="middle" fontSize={fontSize} fill={textColor} fontFamily="ui-monospace, monospace">
          {lines.map((t, i) => (
            <tspan key={i} x={svgW / 2} y={cy + (i - (lines.length - 1) / 2) * fontSize * 1.1 + fontSize / 3}>
              {t}
            </tspan>
          ))}
        </text>
      ) : label ? (
        <text
          x={svgW / 2}
          y={inside ? cy + fontSize / 3 : h + fontSize - 2}
          textAnchor="middle"
          fontSize={fontSize}
          fill={textColor}
          fontFamily="ui-monospace, monospace"
          style={{ fontStyle: imprint === UNVERIFIED ? "italic" : "normal" }}
        >
          {label.length > 14 ? label.slice(0, 14) + "…" : label}
        </text>
      ) : null}
    </svg>
  );
}

/** 長径×短径の表示用文字列 */
export function sizeText(t: Tablet | undefined): string {
  if (!t || t.size_long_mm == null) return "大きさ：未確認";
  if (t.shape === "round" || t.size_short_mm == null || t.size_short_mm === t.size_long_mm)
    return `直径 ${t.size_long_mm}mm`;
  return `${t.size_long_mm}×${t.size_short_mm}mm`;
}
