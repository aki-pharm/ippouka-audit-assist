import { z } from "zod";

/** 服用時点。今回は朝・昼・夕のみ（眠前などは対象外） */
export const TIMINGS = ["morning", "noon", "evening"] as const;
export type Timing = (typeof TIMINGS)[number];
export const TIMING_LABEL: Record<Timing, string> = {
  morning: "朝",
  noon: "昼",
  evening: "夕",
};

/** 未確認を表す定数（刻印の「なし」とは区別する） */
export const UNVERIFIED = "未確認" as const;

export const ShapeSchema = z.enum(["round", "oval", "oblong", "other"]);
export type Shape = z.infer<typeof ShapeSchema>;

/** 医薬品マスタ（1製品＝1行。規格・メーカーごとに別行） */
export const TabletSchema = z.object({
  id: z.string(),
  brand_name: z.string(),
  generic_name: z.string(),
  strength: z.string(),
  maker: z.string().nullable(),
  // 親マスタ（data/parent/parent-master.json）の製品と、同じ薬（成分・規格・剤形）の鍵。lib/makers.ts の drugKey() と同じ形
  product_key: z.string().nullable().default(null),
  drug_key: z.string().nullable().default(null),
  // 今のメーカーの状態（確認ずみ（現物）／記憶ベース／記憶ベース（両方使用）／札の読み取り（未確認）／未選択）。null は従来どおり確定扱い
  maker_state: z.string().nullable().default(null),
  dosage_form: z.enum(["tablet", "capsule", "other"]),
  imprint_front: z.string(), // 文字列 / "なし" / "未確認"
  imprint_back: z.string(),
  imprint_note: z.string().nullable(),
  color: z.string(), // 色名（添付文書の表現）/ "未確認"
  color_hex: z.string().nullable(), // 表示用。人が決める
  shape: ShapeSchema.nullable(),
  size_long_mm: z.number().nullable(),
  size_short_mm: z.number().nullable(),
  thickness_mm: z.number().nullable(),
  score_line: z.boolean().nullable(),
  pack_rule: z.enum(["include", "exclude"]),
  pack_rule_reason: z.string().nullable(),
  fill_method: z.enum(["cassette", "manual"]).nullable(),
  adopted: z.boolean(),
  aliases: z.array(z.string()).default([]), // 処方箋での別表記（一般名処方など）
  source_url: z.string().nullable(),
  source_revision: z.string().nullable(),
  source_page: z.number().int().nullable(), // 添付文書PDFの「性状」が載っているページ
  source_quote: z.string().nullable(),
  verified_by: z.string().nullable(),
  verified_at: z.string().nullable(),
  status: z.enum(["draft", "verified"]),
});
export type Tablet = z.infer<typeof TabletSchema>;

/** 処方箋の読み取り結果（Claudeが返す。薬剤師が画面で直す） */
export const PerTimingSchema = z.object({
  morning: z.number().int().min(0),
  noon: z.number().int().min(0),
  evening: z.number().int().min(0),
});

export const RxItemSchema = z.object({
  rp: z.string().describe("Rp番号（例: 01）。なければ空文字"),
  name_as_written: z
    .string()
    .describe("薬品名を処方箋のとおりに。括弧内の補足は含めない"),
  name_note: z
    .string()
    .nullable()
    .describe("薬品名の後ろの括弧内の補足（例: 通院HD患者は院内処方）"),
  strength: z.string().nullable().describe("規格（例: 5mg, 500μg）"),
  dosage_form: z
    .enum(["tablet", "capsule", "other"])
    .describe("錠剤=tablet、カプセル=capsule、それ以外（ゼリー、散剤等）=other"),
  dose_per_time: z.number().nullable().describe("1回量（錠数）"),
  times_per_day: z.number().int().nullable().describe("1日の回数"),
  dose_per_day: z.number().nullable().describe("1日量（錠数）"),
  per_timing: PerTimingSchema.describe(
    "朝・昼・夕それぞれに入る錠数。『1-0-2 で投与』のような指示はそのまま反映。就寝前など対象外の時点は含めない",
  ),
  days: z.number().int().nullable().describe("日数"),
  raw_usage_text: z.string().describe("用法の文言をそのまま"),
  pack_instruction: z
    .enum(["exclude", "none"])
    .describe("行に『別包』『ヒート包装』『PTP』等の指示があれば exclude、なければ none"),
  manual_fill_mark: z
    .boolean()
    .describe("行頭に□コ（コンベア＝手巻き）のマークがあれば true"),
  confidence: z.enum(["high", "medium", "low"]),
});
export type RxItem = z.infer<typeof RxItemSchema>;

export const RxReadResultSchema = z.object({
  items: z.array(RxItemSchema),
  all_one_dose: z
    .boolean()
    .describe("末尾に『All One Dose』等の一包化の指示があれば true"),
  include_all_note: z
    .string()
    .nullable()
    .describe(
      "『○○も含めて一包化』のように、通常は入れない薬も入れる指示があればその文言。なければ null",
    ),
  notes: z.string().nullable().describe("読み取れなかった箇所や注意点"),
});
export type RxReadResult = z.infer<typeof RxReadResultSchema>;

/** 画面で扱う行（読み取り結果＋マスタ照合＋薬剤師の判断） */
export type RxRow = RxItem & {
  key: string;
  tablet_id: string | null; // 照合したマスタの id
  candidates: string[]; // 候補が複数あるとき
  include: boolean; // 一包化に入れるか（最終）
  include_default: boolean; // 初期値（指示＋施設ルール）
  include_reason: string; // 初期値の根拠
};
