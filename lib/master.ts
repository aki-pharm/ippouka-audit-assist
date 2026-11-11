import masterJson from "@/data/master.json";
import { TabletSchema, type Tablet } from "./types";
// 照合の本体（Node で単体でも動くように拡張子つきで読む。tsconfig の allowImportingTsExtensions）
import { matchRx, previousProductKeys, type Match, type MatchOptions } from "./matching.ts";
import { MATCH_DATA } from "./match-data.ts";

let cache: Tablet[] | null = null;

/** マスタを読み込む（型チェックつき） */
export function loadMaster(): Tablet[] {
  if (!cache) cache = masterJson.map((m) => TabletSchema.parse(m));
  return cache;
}

export function findTablet(id: string | null | undefined): Tablet | undefined {
  if (!id) return undefined;
  return loadMaster().find((t) => t.id === id);
}

/** 全角→半角、空白除去、μ/µの統一など */
export function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[\s　]/g, "")
    .replace(/[µμ]/g, "μ")
    .replace(/㎎/g, "mg")
    .replace(/[（(][^）)]*[）)]/g, "") // 括弧内の補足を除く
    .toLowerCase();
}

/** 「」内のメーカー名を取り除く */
export function stripMaker(s: string): string {
  return s.replace(/[「『][^」』]*[」』]/g, "");
}

/** 【般】や (K) (Ca) などの接頭辞を取り除く */
export function stripPrefix(s: string): string {
  return s.replace(/^(【般】|\[般\]|般|\(k\)|\(ca\)|\(na\))/i, "");
}

export function extractStrength(s: string): string | null {
  const m = normalize(s).match(/(\d+(?:\.\d+)?)(mg|μg|g|%|iu|単位)/);
  return m ? `${m[1]}${m[2]}` : null;
}

/** 薬品名から「基幹部分」（錠・カプセルより前）を取り出す */
export function baseName(s: string): string {
  const n = stripPrefix(normalize(stripMaker(s)));
  const m = n.match(/^(.+?)(od錠|cr錠|錠|カプセル|cap|経口ゼリー|ゼリー|散|細粒|顆粒|液)/);
  return m ? m[1] : n.replace(/\d.*$/, "");
}

export type MatchResult = Match<Tablet>;

/**
 * 処方箋の表記をマスタ（施設の採用品）と照合する。中身は lib/matching.ts の matchRx（薬の鍵＝成分・規格・剤形で照合）。
 * 戻り値の best・candidates・substituted は前と同じ。status（採用品／採用外（市販品あり）／該当なし）・note・previous なども返す
 */
export function matchTablet(nameAsWritten: string, strength?: string | null, options: MatchOptions = {}): MatchResult {
  return matchRx(nameAsWritten, strength, loadMaster(), MATCH_DATA, options);
}

/** メーカー選択で「以前の採用」の札をつける製品（メーカー切替で採用をやめたもの）の product_key */
export function previousAdopted(drug: string | null | undefined): Set<string> {
  return previousProductKeys(drug, loadMaster(), MATCH_DATA);
}

/** 添付文書を開くリンク。ページ番号があればそのページを直接開く（#page= はPDFビューアの慣例） */
export function sourceLink(t: Tablet | undefined): { href: string; direct: boolean } {
  if (t?.source_url) {
    const page = t.source_page ? `#page=${t.source_page}` : "";
    return { href: `${t.source_url}${page}`, direct: true };
  }
  return { href: "https://www.pmda.go.jp/PmdaSearch/iyakuSearch/", direct: false };
}
