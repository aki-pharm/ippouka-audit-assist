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

/** 錠剤イラスト（SVG）。形・色・大きさ・刻印をマスタから描く */
export function TabletSvg({
  tablet,
  face = "front",
  highlight = false,
}: {
  tablet: Tablet | undefined;
  face?: "front" | "back";
  highlight?: boolean;
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

  const fontSize = Math.max(9, Math.min(13, short / 3));
  const label =
    !tablet ? "?" : imprint === UNVERIFIED ? "未確認" : imprint === "なし" ? "" : imprint ?? "";
  // 文字が錠剤に収まるなら中に、収まらなければ下に添える（全角は1.0、半角は0.6文字幅として概算）
  const textWidth = [...label].reduce((acc, ch) => acc + (ch.charCodeAt(0) > 0xff ? 1 : 0.6), 0) * fontSize;
  const inside = textWidth <= long - 6;
  const captionH = label && !inside ? fontSize + 4 : 0;
  const totalH = h + captionH;
  const svgW = inside ? w : Math.min(Math.max(w, textWidth + 12), 150);
  const offsetX = (svgW - w) / 2;
  const textColor = imprint === UNVERIFIED ? "#9CA3AF" : "#1F2937";

  return (
    <svg width={svgW} height={totalH} viewBox={`0 0 ${svgW} ${totalH}`} role="img" aria-label={tablet ? `${tablet.brand_name} の錠剤` : "未登録の錠剤"}>
      <g transform={`translate(${offsetX} 0)`}>
        {body}
        {tablet?.score_line && <line x1={cx} y1={cy - short / 2 + 2} x2={cx} y2={cy + short / 2 - 2} stroke="#9CA3AF" strokeWidth={1} />}
      </g>
      {label && (
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
      )}
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
