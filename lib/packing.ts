import { TIMINGS, type Timing, type RxItem, type RxRow, type RxReadResult, type Tablet } from "./types";
import { findTablet, matchTablet } from "./master";
import type { DrawnTablet } from "./makers";
import { fixUsage } from "./rxFix.ts";
import { lookAlike } from "./lookalike.ts";

/** 入れる／入れないの初期値。優先：行の別包指示 > 緑字の「含めて一包化」 > 施設ルール > 剤形 */
export function defaultInclude(
  item: RxItem,
  tablet: Tablet | undefined,
  rx: Pick<RxReadResult, "all_one_dose" | "include_all_note">,
): { include: boolean; reason: string } {
  if (item.pack_instruction === "exclude") return { include: false, reason: "処方箋の指示：別包" };
  if (item.dosage_form === "other") return { include: false, reason: "錠剤・カプセル以外" };
  if (rx.include_all_note) return { include: true, reason: `処方箋の指示：${rx.include_all_note}` };
  if (tablet?.pack_rule === "exclude") return { include: false, reason: tablet.pack_rule_reason ?? "施設ルール" };
  if (!rx.all_one_dose) return { include: true, reason: "一包化の指示なし（確認してください）" };
  return { include: true, reason: "一包化" };
}

/** 読み取り結果 → 画面の行 */
export function toRows(rx: RxReadResult): RxRow[] {
  return rx.items.map((raw, i) => {
    // 寝る前の柵と「a-b-c-d-e-f で投与」の計算し直し（/api/read-rx でも当てているが、手で入れた結果・サンプルにも当てる。2 回当てても同じ）
    const item = fixUsage(raw);
    const m = matchTablet(item.name_as_written, item.strength, { nameNote: item.name_note });
    const tablet = m.best ?? undefined;
    const d = defaultInclude(item, tablet, rx);
    return {
      ...item,
      key: `${i}-${item.rp}`,
      tablet_id: m.best?.id ?? null,
      candidates: m.candidates.map((c) => c.id),
      include: d.include,
      include_default: d.include,
      include_reason: d.reason,
      match_status: m.status,
      match_note: m.note,
    };
  });
}

/** 行の再評価（マスタの対応品を手で変えたとき） */
export function recomputeDefault(row: RxRow, rx: Pick<RxReadResult, "all_one_dose" | "include_all_note">): RxRow {
  const d = defaultInclude(row, findTablet(row.tablet_id), rx);
  return { ...row, include_default: d.include, include_reason: d.reason, include: d.include };
}

export type CheckFlag = { level: "warn" | "info"; message: string };

/** 検算と照合のチェック。処方の是非は判断しない（言葉づかいの方針） */
export function checkRow(row: RxRow): CheckFlag[] {
  const flags: CheckFlag[] = [];
  const perSum = row.per_timing.morning + row.per_timing.noon + row.per_timing.evening;
  if (row.dose_per_time != null && row.times_per_day != null && row.dose_per_day != null) {
    if (Math.abs(row.dose_per_time * row.times_per_day - row.dose_per_day) > 1e-6)
      flags.push({ level: "warn", message: "読み取り値が一致しません（1回量×回数≠1日量）" });
  }
  for (const f of row.usage_flags ?? []) flags.push({ level: "warn", message: f });
  // 寝る前・起床時などの分は袋に入れないので、朝昼夕の合計＋袋に入れない分で 1日量と比べる
  if (row.dose_per_day != null && row.dosage_form !== "other" && perSum + (row.unplaced ?? 0) !== row.dose_per_day)
    flags.push({ level: "warn", message: `朝昼夕の合計(${perSum})と1日量(${row.dose_per_day})が一致しません` });
  if (perSum === 0 && !(row.unplaced ?? 0) && !(row.usage_flags ?? []).length && row.dosage_form !== "other")
    flags.push({ level: "warn", message: "服用時点（朝・昼・夕）が読み取れていません" });
  if (!row.tablet_id) {
    flags.push(
      row.candidates.length
        ? { level: "warn", message: row.match_note ?? "マスタの候補が複数あります。選んでください" }
        : row.match_status === "採用外（市販品あり）"
          ? { level: "warn", message: `採用外（市販品あり）${row.match_note ? "：" + row.match_note : ""}` }
          : { level: "warn", message: "マスタに該当がありません" },
    );
  }
  // 手で採用中止・以前の採用の製品を選んだ行は、そのことを知らせる（lib/pick.ts の pickRowState が状態を付ける）
  if (row.tablet_id && (row.match_status === "採用中止" || row.match_status === "以前の採用"))
    flags.push({ level: "warn", message: `${row.match_status}の製品を選んでいます` });
  if (row.confidence === "low") flags.push({ level: "info", message: "読み取りの確度が低い行です" });
  // 分包方法の突き合わせ：処方箋の「□コ」（手巻き）とマスタの分包方法が食い違えば知らせる（判断は薬剤師）
  const tablet = findTablet(row.tablet_id);
  if (tablet?.fill_method && row.include && row.dosage_form !== "other") {
    if (row.manual_fill_mark && tablet.fill_method === "cassette")
      flags.push({ level: "info", message: "処方箋は手巻き（□コ）ですが、マスタではカセットです" });
    if (!row.manual_fill_mark && tablet.fill_method === "manual")
      flags.push({ level: "info", message: "マスタでは手巻きですが、処方箋に□コがありません" });
  }
  return flags;
}

/** pending：今のメーカーが決まっていない（未選択・両方使用）ので描かない。図には「メーカー未確定」の札を出す */
export type BagEntry = { row: RxRow; tablet: DrawnTablet | undefined; count: number; group: string | null; pending: boolean };
/** 行 → 図に描く製品（1 つの薬に 1 製品）。既定はマスタの対応品そのまま */
export type DrawResolver = (row: RxRow) => { tablet: DrawnTablet | undefined; pending: boolean };
export type Bag = { timing: Timing; entries: BagEntry[]; total: number; groups: SimilarGroup[] };
export type SimilarGroup = { label: string; tablet_ids: string[]; note: string };
/** イメージ図の並び順：処方箋の記載順（既定）／大きさ順（長径の大きい順。大きさ未確認は最後） */
export type BagOrder = "rx" | "size";
export const BAG_ORDER_LABEL: Record<BagOrder, string> = { rx: "処方箋の記載順", size: "大きさ順" };

/** 表示用の並べ替え。似た外観の判定（group）は並び順に関係なく済んでいるので、ここでは順番だけ変える */
export function sortEntries(entries: BagEntry[], order: BagOrder): BagEntry[] {
  if (order === "rx") return entries;
  const key = (e: BagEntry) => {
    const t = e.tablet;
    if (!t || t.dosage_form !== "tablet" || t.size_long_mm == null) return null;
    return t.size_long_mm * 100 + (t.size_short_mm ?? 0);
  };
  return entries
    .map((e, i) => ({ e, i, k: key(e) }))
    .sort((a, b) => {
      if (a.k == null && b.k == null) return a.i - b.i;
      if (a.k == null) return 1;
      if (b.k == null) return -1;
      return b.k - a.k || a.i - b.i;
    })
    .map((x) => x.e);
}

/** 袋ごとの中身を組み立てる（処方箋の記載順）。resolve でメーカー選択の結果を反映する（lib/makers.ts の productToDraw） */
export function buildBags(
  rows: RxRow[],
  resolve: DrawResolver = (r) => ({ tablet: findTablet(r.tablet_id), pending: false }),
): Bag[] {
  return TIMINGS.map((timing) => {
    const entries: BagEntry[] = rows
      .filter((r) => r.include && r.per_timing[timing] > 0)
      .map((r) => ({ row: r, ...resolve(r), count: r.per_timing[timing], group: null }));
    const groups = findSimilar(entries);
    for (const e of entries) {
      const g = groups.find((g) => e.tablet && g.tablet_ids.includes(e.tablet.id));
      e.group = g ? g.label : null;
    }
    const total = entries.reduce((s, e) => s + e.count, 0);
    return { timing, entries, total, groups };
  });
}

/**
 * 似た外観の組を見つける：lib/lookalike.ts の lookAlike（同じ形・色が近い・長径・短径・厚さが近い。数値は LOOKALIKE_PARAMS）。
 * 大きさ・厚さが未確認の欄はその欄では外さない。ルールで判定し、AIは使わない。
 */
export function findSimilar(entries: BagEntry[]): SimilarGroup[] {
  const tablets = entries
    .map((e) => e.tablet)
    .filter((t): t is Tablet => !!t && t.dosage_form === "tablet" && !!t.shape && t.color !== "未確認");
  const unique = [...new Map(tablets.map((t) => [t.id, t])).values()];
  const similar = (a: Tablet, b: Tablet) => lookAlike(a, b).similar;
  // 似ている同士をつないでいき、つながった塊を1つの組にする（6.5mm・7.1mm・8.0mm のように鎖でつながる白い錠剤も同じ組になる）
  const used = new Set<string>();
  const groups: SimilarGroup[] = [];
  const labels = "ABCDEFGH";
  for (const start of unique) {
    if (used.has(start.id)) continue;
    const members: Tablet[] = [start];
    used.add(start.id);
    for (let i = 0; i < members.length; i++) {
      for (const b of unique) {
        if (used.has(b.id) || !similar(members[i], b)) continue;
        used.add(b.id);
        members.push(b);
      }
    }
    if (members.length < 2) continue;
    const label = labels[groups.length] ?? String(groups.length + 1);
    const unknownSize = members.some((m) => m.size_long_mm == null);
    groups.push({
      label,
      tablet_ids: members.map((m) => m.id),
      note: unknownSize ? "形と色が同じ（大きさは未確認）。刻印で区別" : "形・色・大きさが近い。刻印で区別",
    });
  }
  return groups;
}
