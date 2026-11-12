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
