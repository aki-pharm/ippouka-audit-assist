/**
 * 読み取り結果の後処理（決まった手順。API を使わない）。/api/read-rx と採点用のランナー（scripts/read-rx-batch.ts）が同じものを使う。
 * Next.js なしで動かせるように、値の import をしない（型だけ）。
 *
 * 規格（strength）が空で、薬品名に規格が書いてあれば、名前から規格を入れる：
 *   - 数値と単位（5mg・0.25mg・500μg・12μg・8mEq・10単位・1%）。名前の中の最後のもの（メーカーの「」の中は見ない）
 *   - 配合錠・配合カプセルで数値が無いときは、後ろの記号全体（ユニシア配合錠HD → HD、バファリン配合錠A81 → A81、アマルエット配合錠1番 → 1番、
 *     クリアミン配合錠S0.5 → S0.5、ユーエフティ配合カプセルT100 → T100）。記号の形でなければ null
 *   どちらも無ければ空のまま（推し量らない）。名前は変えない（処方箋の表記どおりかを採点で比べるため）
 */
import type { RxReadResult } from "./types";

/** 薬品名から規格を取り出す。取れなければ null */
export function strengthFromName(name: string | null | undefined): string | null {
  const n = (name ?? "").normalize("NFKC").replace(/µ/g, "μ").replace(/「[^」]*」|『[^』]*』/g, "");
  const nums = [...n.matchAll(/(\d+(?:\.\d+)?)\s*(mg|μg|ug|mcg|g|mEq|単位|%)/gi)];
  if (nums.length) {
    const [, v, u] = nums[nums.length - 1];
    const unit = /^(ug|mcg)$/i.test(u) ? "μg" : /^meq$/i.test(u) ? "mEq" : /^(mg|g)$/i.test(u) ? u.toLowerCase() : u;
    return `${v}${unit}`;
  }
  if (/配合/.test(n)) {
    // 配合錠・配合カプセルの後ろの記号は、残り全体が記号の形のときだけ使う（途中で切った記号は返さない。分からなければ null）
    const rest = n.match(/配合(?:OD)?(?:錠|カプセル)\s*(.*)$/)?.[1]?.replace(/[\s　]/g, "") ?? "";
    if (/^([A-Z]{1,4}\d+(?:\.\d+)?|[A-Z]{1,4}|\d+番|\d+(?:\.\d+)?[A-Z]{1,3})$/.test(rest)) return rest;
  }
  return null;
}

/** 読み取り結果の各行で、規格が空なら名前から入れる。元の結果は変えず、新しい結果と入れた行の数を返す */
export function fillStrengthFromName(result: RxReadResult): { result: RxReadResult; filled: number } {
  let filled = 0;
  const items = result.items.map((it) => {
    if (it.strength != null && String(it.strength).trim() !== "") return it;
    const s = strengthFromName(it.name_as_written);
    if (!s) return it;
    filled++;
    return { ...it, strength: s };
  });
  return { result: { ...result, items }, filled };
}

// ---------- 用法の後処理（寝る前・起床時の柵と「a-b-c-… で投与」の計算し直し） ----------
//  数字の並び（「1-0-2-0-0-0」「(2-1-1-1)」）の位置には全国で決まった意味が無い（厚労省の例「(2-1-1-1) 分4 朝・昼・夕食後及び就寝前」）。
//  そこで、0 でない数を前から順に、用法の文に書かれた時点（起床時・朝・昼・夕・寝る前・食間／○時）に書かれた順で当てる（AKI 11/12）

/** 後処理で行に足す印。usage_flags は表で黄色にする一言、unplaced は袋に入れない錠数（寝る前・起床時・食間など） */
export type UsageFixed<T> = T & { usage_flags?: string[]; unplaced?: number };
export type DoseTime = "wake" | "morning" | "noon" | "evening" | "bedtime" | "other";

export const NOTE_OUTSIDE = "寝る前／起床時：この画面の対象外";
export const NOTE_OTHER_TIME = "食間・時刻の指定：この画面の対象外";
export const NOTE_MISMATCH = "用法の並びと時点が合いません：要確認";
export const NOTE_RECALC = "用法の並びから計算し直しました";
const NOTE_EVENING = "夕・朝と寝る前・起床時の量を確かめてください";

/** 用法の文から、数字の並び（3 つ以上、または「で投与」の前か括弧の中なら 2 つ以上）を取り出す。無ければ null */
export function parseNumberRun(text: string | null | undefined): number[] | null {
  const t = (text ?? "").normalize("NFKC").replace(/[‐‑‒–—―−ー]/g, "-");
  for (const m of t.matchAll(/(\(?)\s*(\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)+)\s*(\)?)\s*(で投与)?/g)) {
    const v = m[2].split("-").map((x) => Number(x.trim()));
    if (v.length >= 3 || (v.length >= 2 && (m[4] || (m[1] && m[3])))) return v;
  }
  return null;
}

/** 用法の文に書かれた時点を、書かれた順に返す（数字の並びの部分は除く）。毎食後は 朝・昼・夕 */
export function parseDoseTimes(text: string | null | undefined): DoseTime[] {
  const t = (text ?? "").normalize("NFKC").replace(/[‐‑‒–—―−ー]/g, "-").replace(/\(?\s*\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)+\s*\)?/g, " ");
  const out: DoseTime[] = [];
  for (const m of t.matchAll(/起床時|就寝前|眠前|寝る前|毎食|朝|昼|夕|食間|\d+時(?!間)/g)) {
    const w = m[0];
    if (w === "起床時") out.push("wake");
    else if (w === "就寝前" || w === "眠前" || w === "寝る前") out.push("bedtime");
    else if (w === "毎食") out.push("morning", "noon", "evening");
    else if (w === "朝") out.push("morning");
    else if (w === "昼") out.push("noon");
    else if (w === "夕") out.push("evening");
    else out.push("other");
  }
  return out;
}

/**
 * 数字の並びを時点に当てる。0 でない数を前から順に、時点に書かれた順で。数が合わない・同じ時点が 2 回あるなら null（当てない）
 * 例：「1-0-2-0-0-0 1日2回 朝夕食後」→ 朝 1・夕 2、「1-2-0-0-0-0 起床時・朝食後」→ 起床時 1・朝 2、「(2-1-1-1) 朝・昼・夕食後及び就寝前」→ 2・1・1・1
 */
export function mapPattern(text: string | null | undefined): { amounts: Partial<Record<DoseTime, number>> } | { mismatch: true } | null {
  const nums = parseNumberRun(text);
  if (!nums) return null;
  const nz = nums.filter((x) => x !== 0);
  const times = parseDoseTimes(text);
  if (!nz.length || nz.length !== times.length || new Set(times).size !== times.length) return { mismatch: true };
  const amounts: Partial<Record<DoseTime, number>> = {};
  times.forEach((t, i) => (amounts[t] = nz[i]));
  return { amounts };
}

/**
 * 1 行の用法を後処理する（決まった手順。元の行は変えない。何も変えないときは同じ行をそのまま返す）。
 *  - 数字の並びがあれば mapPattern で当て、朝・昼・夕をその数にする（読み取りと違えば「用法の並びから計算し直しました」）。
 *    寝る前・起床時・食間などの分は袋に入れない（unplaced）。当てられなければ袋に入れず（朝昼夕 0）「用法の並びと時点が合いません：要確認」
 *  - 並びが無く、用法に 寝る前／起床時 があるとき：夕（起床時なら朝）の文字が無ければその時点を 0 に、あれば 1 回量（欄か用法の「1回1錠」）までにする。
 *    1 回量が分からなければそのまま「…量を確かめてください」
 */
export function fixUsage<T extends { raw_usage_text: string; per_timing: { morning: number; noon: number; evening: number }; dose_per_time: number | null; dose_per_day: number | null }>(
  item: T & { usage_flags?: string[]; unplaced?: number },
): UsageFixed<T> {
  const text = (item.raw_usage_text ?? "").normalize("NFKC");
  const flags = new Set(item.usage_flags ?? []);
  let per = { ...item.per_timing };
  let unplaced = item.unplaced ?? 0;
  const mp = mapPattern(text);
  if (mp && "mismatch" in mp) {
    flags.add(NOTE_MISMATCH);
    per = { morning: 0, noon: 0, evening: 0 };
  } else if (mp) {
    const a = mp.amounts;
    const want = { morning: a.morning ?? 0, noon: a.noon ?? 0, evening: a.evening ?? 0 };
    if (want.morning !== per.morning || want.noon !== per.noon || want.evening !== per.evening) flags.add(NOTE_RECALC);
    per = want;
    unplaced = (a.wake ?? 0) + (a.bedtime ?? 0) + (a.other ?? 0);
    if (a.wake || a.bedtime) flags.add(NOTE_OUTSIDE);
    if (a.other) flags.add(NOTE_OTHER_TIME);
  } else {
    const textDose = Number(text.match(/1回\s*(\d+(?:\.\d+)?)\s*(錠|カプセル|個)/)?.[1]);
    const dpt = item.dose_per_time ?? (Number.isFinite(textDose) && textDose > 0 ? textDose : null);
    // 寝る前は夕に、起床時は朝に入れない
    for (const [re, slot, named] of [[/就寝前|眠前|寝る前/, "evening", /夕/], [/起床時/, "morning", /朝/]] as const) {
      if (!re.test(text)) continue;
      flags.add(NOTE_OUTSIDE);
      if (!named.test(text)) {
        if (!(item.unplaced ?? 0)) unplaced += per[slot] > 0 ? per[slot] : dpt ?? 0;
        per[slot] = 0;
      } else if (dpt != null) {
        if (!(item.unplaced ?? 0)) unplaced += per[slot] > dpt ? per[slot] - dpt : dpt;
        per[slot] = Math.min(per[slot], dpt);
      } else flags.add(NOTE_EVENING);
    }
  }
  const same = per.morning === item.per_timing.morning && per.noon === item.per_timing.noon && per.evening === item.per_timing.evening;
  if (same && flags.size === (item.usage_flags?.length ?? 0) && unplaced === (item.unplaced ?? 0)) return item;
  const out: UsageFixed<T> = { ...item, per_timing: per, usage_flags: [...flags] };
  if (unplaced > 0) out.unplaced = unplaced;
  return out;
}

/** 読み取り結果の全行に fixUsage を当てる。直した行の数を返す */
export function fixUsageAll<R extends { items: Parameters<typeof fixUsage>[0][] }>(result: R): { result: R; fixed: number } {
  let fixed = 0;
  const items = result.items.map((it) => {
    const f = fixUsage(it);
    if (f !== it) fixed++;
    return f;
  });
  return { result: { ...result, items }, fixed };
}
