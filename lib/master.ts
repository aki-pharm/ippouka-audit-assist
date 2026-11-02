import masterJson from "@/data/master.json";
import { TabletSchema, type Tablet } from "./types";

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

export type MatchResult = {
  best: Tablet | null;
  candidates: Tablet[];
  substituted: boolean; // 処方箋の表記とメーカー等が違う採用品に置き換えた
};

/**
 * 処方箋の表記をマスタと照合する。
 * 優先：製品名＋メーカー一致 > 製品名一致 > 一般名＋規格一致（採用品に置き換え）
 */
export function matchTablet(nameAsWritten: string, strength?: string | null): MatchResult {
  const master = loadMaster();
  const written = normalize(nameAsWritten);
  const writtenNoMaker = stripPrefix(normalize(stripMaker(nameAsWritten)));
  const writtenStrength = strength ? normalize(strength) : extractStrength(nameAsWritten);
  const writtenBase = baseName(nameAsWritten);

  const exact = master.filter((t) => normalize(t.brand_name) === written);
  if (exact.length) return { best: pick(exact), candidates: exact, substituted: false };

  const alias = master.filter((t) => t.aliases.some((a) => normalize(a) === written));
  if (alias.length) return { best: pick(alias), candidates: alias, substituted: true };

  const brandNoMaker = master.filter(
    (t) => normalize(stripMaker(t.brand_name)) === writtenNoMaker,
  );
  if (brandNoMaker.length) {
    const b = pick(brandNoMaker);
    return {
      best: b,
      candidates: brandNoMaker,
      substituted: !!b && normalize(b.brand_name) !== written,
    };
  }

  // 一般名＋規格（メーカー違い・一般名処方）
  const byGeneric = master.filter((t) => {
    const g = normalize(t.generic_name);
    const sameStrength = !writtenStrength || normalize(t.strength) === writtenStrength;
    const baseHit =
      writtenBase.length >= 3 && (g.startsWith(writtenBase) || writtenBase.startsWith(g.slice(0, Math.max(3, g.length - 4))));
    const brandBase = baseName(t.brand_name);
    const brandHit = writtenBase.length >= 3 && brandBase === writtenBase;
    return sameStrength && (baseHit || brandHit);
  });
  if (byGeneric.length) {
    const adopted = byGeneric.filter((t) => t.adopted);
    const pool = adopted.length ? adopted : byGeneric;
    return { best: pool.length === 1 ? pool[0] : null, candidates: pool, substituted: true };
  }
  return { best: null, candidates: [], substituted: false };
}

function pick(list: Tablet[]): Tablet | null {
  const adopted = list.filter((t) => t.adopted);
  const pool = adopted.length ? adopted : list;
  return pool.length === 1 ? pool[0] : null;
}

/** 添付文書を開くリンク。ページ番号があればそのページを直接開く（#page= はPDFビューアの慣例） */
export function sourceLink(t: Tablet | undefined): { href: string; direct: boolean } {
  if (t?.source_url) {
    const page = t.source_page ? `#page=${t.source_page}` : "";
    return { href: `${t.source_url}${page}`, direct: true };
  }
  return { href: "https://www.pmda.go.jp/PmdaSearch/iyakuSearch/", direct: false };
}
