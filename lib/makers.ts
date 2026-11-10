/**
 * メーカー選択（同じ成分・規格・剤形の他社製品から 1 つ選んで、図に描く製品を決める）
 *
 * Next.js なしで動かせるように、ここでは値の import をしない（型だけ）。
 * 候補の索引（data/parent/maker-index.json）は引数で受け取る。
 *   node --experimental-strip-types で読める（相対パスの値 import・パスエイリアス・enum を使わない）
 * 文字の正規化は lib/master.ts の normalize と同じ考え方の小さな写し（依存を持たないため）。
 */
import type { Tablet } from "./types";

/** 親マスタの確認の状態。verified＝実物で確認／confirmed＝添付文書の外形図を人が確認／draft＝AI の下書きのみ */
export type ParentStatus = "verified" | "confirmed" | "draft";

/** 候補の製品（親マスタの 1 製品。外観と出典） */
export type MakerCandidate = {
  product_key: string;
  brand_name: string;
  maker: string; // 製造販売元（空のことがある）
  imprint_front: string;
  imprint_back: string;
  imprint_note: string | null;
  color: string;
  color_hex: string | null;
  shape: Tablet["shape"];
  size_long_mm: number | null;
  size_short_mm: number | null;
  thickness_mm: number | null;
  score_line: boolean | null;
  status: ParentStatus;
  source_url: string | null;
  source_revision: string | null;
  verified_by: string | null;
  verified_at: string | null;
  flags: string[];
};

/** 1 つの薬（成分・規格・剤形）。索引では空の欄を省いているので Partial で受ける */
export type MakerDrug = {
  generic_name: string;
  strength: string;
  form: string;
  products: (Partial<MakerCandidate> & { product_key: string; brand_name: string })[];
};
export type MakerIndex = { drugs: Record<string, MakerDrug> };

/** 図に描く錠剤。親マスタの候補から作ったときは確認の状態を持つ */
export type DrawnTablet = Tablet & { appearance_status?: ParentStatus | null };

/** 今のメーカーを 1 つに決められない状態（図に描かない） */
export const MAKER_UNKNOWN_STATES = ["未選択", "記憶ベース（両方使用）"] as const;

const STATUS_ORDER: Record<string, number> = { verified: 0, confirmed: 1, draft: 2 };
export const APPEARANCE_STATUS_LABEL: Record<ParentStatus, string> = {
  verified: "確認ずみ（実物）",
  confirmed: "添付文書で確認",
  draft: "下書き（未確認）",
};

function norm(s: string | null | undefined): string {
  return (s ?? "").normalize("NFKC").replace(/[\s・･®（）()「」]/g, "").toLowerCase();
}

/** 規格の比較用（「2.5mg」→「2.5」、「500μg」→「500μg」）。scripts/ops/build-ops-master.py の strength_key と同じ */
export function strengthKey(s: string | null | undefined): string {
  return norm(s).replace("mg", "").replace("ug", "μg");
}

/** 販売名から剤形（錠／OD錠／カプセル／チュアブル錠／ODフィルム／その他） */
export function formOf(name: string | null | undefined): string {
  const n = (name ?? "").normalize("NFKC");
  if (n.includes("ODフィルム")) return "ODフィルム";
  if (n.includes("OD錠") || n.includes("口腔内崩壊")) return "OD錠";
  if (n.includes("カプセル")) return "カプセル";
  if (n.includes("チュアブル")) return "チュアブル錠";
  if (n.includes("錠")) return "錠";
  return "その他";
}

/** 薬の鍵「成分・剤形コード|規格|剤形」（例：2171022F|2.5|OD錠）。scripts/build-maker-index.cjs と同じ */
export function drugKey(group: string, strength: string, brandName: string): string {
  return `${group}|${strengthKey(strength)}|${formOf(brandName)}`;
}

/** 画面に出すメーカー名。販売名の「」内 → maker 欄 → 製造販売元 → （先発）の順 */
export function makerLabel(p: { brand_name: string; maker?: string | null } | undefined | null): string {
  if (!p) return "";
  const m = p.brand_name.normalize("NFKC").match(/「([^」]+)」/);
  if (m) return m[1];
  const maker = (p.maker ?? "").replace(/^製造販売元／/, "").trim();
  return maker ? maker : "（先発）";
}

/** 今のメーカーが決まっていないか（未選択・両方使用）。状態が空（null）の行は従来どおり決まっている扱い */
export function isMakerUnknown(state: string | null | undefined): boolean {
  if (!state) return false;
  return state === "未選択" || state.includes("両方");
}

function toCandidate(p: MakerDrug["products"][number]): MakerCandidate {
  return {
    product_key: p.product_key,
    brand_name: p.brand_name,
    maker: p.maker ?? "",
    imprint_front: p.imprint_front ?? "未確認",
    imprint_back: p.imprint_back ?? "未確認",
    imprint_note: p.imprint_note ?? null,
    color: p.color ?? "未確認",
    color_hex: p.color_hex ?? null,
    shape: p.shape ?? null,
    size_long_mm: p.size_long_mm ?? null,
    size_short_mm: p.size_short_mm ?? null,
    thickness_mm: p.thickness_mm ?? null,
    score_line: p.score_line ?? null,
    status: p.status === "verified" || p.status === "confirmed" ? p.status : "draft",
    source_url: p.source_url ?? null,
    source_revision: p.source_revision ?? null,
    verified_by: p.verified_by ?? null,
    verified_at: p.verified_at ?? null,
    flags: p.flags ?? [],
  };
}

/**
 * 同じ薬（drug_key）の候補。今の製品（currentProductKey）は除く。
 * 並び：確認の状態（実物 → 添付文書 → 下書き）、同じなら販売名の順。鍵が無い・索引に無いときは空配列。
 */
export function findCandidates(
  index: MakerIndex,
  key: string | null | undefined,
  currentProductKey?: string | null,
): MakerCandidate[] {
  if (!key) return [];
  const d = index.drugs[key];
  if (!d) return [];
  return d.products
    .filter((p) => p.product_key !== currentProductKey)
    .map(toCandidate)
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.brand_name.localeCompare(b.brand_name, "ja"));
}

/**
 * 候補の製品を、図に描く錠剤にする。外観と出典は候補（親マスタ）から、
 * 一包化区分・分包方法・一般名など施設の決まりは施設のマスタの行から取る。
 * 実物で確認した製品（verified）以外は status を draft にする（図の枠が点線、情報カードに確認前の帯）。
 */
export function candidateToTablet(facility: Tablet, c: MakerCandidate): DrawnTablet {
  return {
    ...facility,
    id: `${facility.id}@${c.product_key}`,
    brand_name: c.brand_name,
    maker: makerLabel(c),
    product_key: c.product_key,
    maker_state: "この処方で選択",
    imprint_front: c.imprint_front,
    imprint_back: c.imprint_back,
    imprint_note: c.imprint_note,
    color: c.color,
    color_hex: c.color_hex,
    shape: c.shape,
    size_long_mm: c.size_long_mm,
    size_short_mm: c.size_short_mm,
    thickness_mm: c.thickness_mm,
    score_line: c.score_line,
    aliases: [],
    source_url: c.source_url,
    source_revision: c.source_revision,
    source_page: null,
    source_quote: null,
    verified_by: c.verified_by,
    verified_at: c.verified_at,
    status: c.status === "verified" ? "verified" : "draft",
    appearance_status: c.status,
  };
}

/**
 * 図に描く製品を 1 つ決める。1 つの薬に描くのは常に 1 製品。
 *  - 選んだ候補（override）があれば、その製品
 *  - なければ施設のマスタの行。ただし今のメーカーが決まっていない（未選択・両方使用）なら描かない（pending）
 *  - 施設のマスタに行が無ければ tablet は undefined（従来どおり「未登録」）
 */
export function productToDraw(
  facility: Tablet | undefined,
  override: MakerCandidate | null | undefined,
): { tablet: DrawnTablet | undefined; pending: boolean } {
  if (facility && override) return { tablet: candidateToTablet(facility, override), pending: false };
  if (facility && isMakerUnknown(facility.maker_state)) return { tablet: undefined, pending: true };
  return { tablet: facility, pending: false };
}

/** 描く製品が実物で確認されていないか（「未確認」を出す） */
export function isUnconfirmed(t: DrawnTablet | undefined): boolean {
  return !!t && t.status !== "verified";
}

/**
 * 処方箋の表記と、袋に入っている製品が違うときの表示「処方：X → 入っている：Y」。
 * 表記ゆれ（全角半角・空白・括弧内・【般】）と、マスタの別名（aliases）が一致すれば同じ製品とみなして null。
 */
export function mismatchLabel(
  nameAsWritten: string,
  drawn: { brand_name: string; aliases?: string[] } | undefined | null,
): string | null {
  if (!drawn || !nameAsWritten.trim()) return null;
  const key = (s: string) => norm(s.normalize("NFKC").replace(/[（(][^）)]*[）)]/g, "").replace(/^(【般】|\[般\]|般)/, ""));
  const w = key(nameAsWritten);
  if ([drawn.brand_name, ...(drawn.aliases ?? [])].some((n) => key(n) === w)) return null;
  return `処方：${nameAsWritten} → 入っている：${drawn.brand_name}`;
}

/** 「これからはこのメーカー」の変更記録（保存はまだしない。確認係に渡して運用マスタに反映してもらう） */
export type ChangeRecord = {
  drug_key: string;
  generic_name: string;
  strength: string;
  form: string;
  from_maker: string;
  from_product_key: string | null;
  to_maker: string;
  to_product_key: string;
  changed_by: string;
  changed_at: string; // ISO 8601
};

/**
 * 変更記録を作る。changed_by（変更者）が空ならエラー。
 * from が無い・今のメーカーが決まっていないときは from_maker を「メーカー未確定（状態）」にする。
 */
export function buildChangeRecord(args: {
  drug_key: string;
  drug?: Pick<MakerDrug, "generic_name" | "strength" | "form"> | null;
  from: Tablet | undefined;
  to: MakerCandidate;
  changed_by: string;
  at?: Date;
}): ChangeRecord {
  const by = args.changed_by.trim();
  if (!by) throw new Error("変更者を入れてください");
  const unknown = !args.from || isMakerUnknown(args.from.maker_state);
  return {
    drug_key: args.drug_key,
    generic_name: args.drug?.generic_name ?? args.from?.generic_name ?? "",
    strength: args.drug?.strength ?? args.from?.strength ?? "",
    form: args.drug?.form ?? args.drug_key.split("|")[2] ?? "",
    from_maker: unknown ? `メーカー未確定（${args.from?.maker_state ?? "マスタに無い"}）` : makerLabel(args.from),
    from_product_key: unknown ? null : (args.from?.product_key ?? null),
    to_maker: makerLabel(args.to),
    to_product_key: args.to.product_key,
    changed_by: by,
    changed_at: (args.at ?? new Date()).toISOString(),
  };
}

const CSV_COLUMNS: [keyof ChangeRecord, string][] = [
  ["drug_key", "薬の鍵"],
  ["generic_name", "成分"],
  ["strength", "規格"],
  ["form", "剤形"],
  ["from_maker", "変更前のメーカー"],
  ["from_product_key", "変更前の製品"],
  ["to_maker", "変更後のメーカー"],
  ["to_product_key", "変更後の製品"],
  ["changed_by", "変更者"],
  ["changed_at", "変更日時"],
];

/** 変更記録の CSV（見出しは日本語、改行は \n、BOM なし。カンマ・引用符・改行を含む値は "" で囲む） */
export function changeRecordsToCsv(records: ChangeRecord[]): string {
  const cell = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [CSV_COLUMNS.map(([, h]) => h).join(","), ...records.map((r) => CSV_COLUMNS.map(([k]) => cell(r[k])).join(","))].join("\n") + "\n";
}

/** 変更記録の JSON（2 字下げ） */
export function changeRecordsToJson(records: ChangeRecord[]): string {
  return JSON.stringify(records, null, 2) + "\n";
}
