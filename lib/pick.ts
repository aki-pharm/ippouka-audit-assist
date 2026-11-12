/**
 * 手で製品を選ぶときの判断（画面から外に出した純粋な関数。React に依存しない）
 *
 * - どの札なら理由と変更者が要るか（needsOverrideRecord）
 * - 記録に残す札の名前（overrideRule）
 * - 手で選んだ後の行の一言と状態（pickRowState）
 *
 * 札（kind）は lib/matching.ts の explainCandidate が返すもの：
 *   auto＝この処方でそのまま自動で選ばれる製品、candidate＝候補にとどめる（入れ替えない組・事前合意があれば選択可 など）、
 *   ruleOut＝決まりで外す、discontinued＝採用中止・以前の採用、other＝同じ薬でない（別の薬）
 */
import type { Tablet } from "./types";

export type PickKind = "auto" | "candidate" | "ruleOut" | "discontinued" | "other";
export type PickExplained = { kind: PickKind; reason: string | null };

/** 同じ薬でない製品の札 */
export const OTHER_DRUG_LABEL = "別の薬（読み取りの直し）";
/** 同じ薬でない製品を選んだときの記録の札 */
export const OTHER_DRUG_RULE = "別の薬に直した";

/** この札の製品を選ぶには、理由と変更者を入れて記録する必要があるか（自動で選ばれる製品だけは要らない） */
export function needsOverrideRecord(kind: PickKind): boolean {
  return kind !== "auto";
}

/** 記録に残す札の名前。別の薬は「別の薬に直した」、ほかは札の理由（無ければ札の種類） */
export function overrideRule(ex: PickExplained): string {
  if (ex.kind === "other") return OTHER_DRUG_RULE;
  return ex.reason ?? ex.kind;
}

export type PickRowState = {
  match_note: string | null;
  match_status?: "採用品" | "採用中止" | "以前の採用";
};

/**
 * 行の対応する製品を手で選んだ（null は外した）ときの一言と状態。
 * 状態は選んだ製品の実際の採用の状態（採用中止・以前の採用は「採用品」にしない）。外したときは状態を変えない。
 */
export function pickRowState(product: Pick<Tablet, "adopted" | "discontinued_reason"> | null | undefined, ex?: PickExplained | null): PickRowState {
  if (!product) return { match_note: null };
  if (!product.adopted) {
    const status = product.discontinued_reason === "メーカー切替" ? "以前の採用" : "採用中止";
    return { match_note: `手で選びました（${status}）`, match_status: status };
  }
  if (!ex || ex.kind === "auto" || ex.kind === "discontinued") return { match_note: "手で選びました", match_status: "採用品" };
  if (ex.kind === "other") return { match_note: `手で選びました（${OTHER_DRUG_RULE}）`, match_status: "採用品" };
  return { match_note: `手で選びました（${ex.kind === "ruleOut" ? "ルール外：" : ""}${ex.reason ?? "候補"}）`, match_status: "採用品" };
}
