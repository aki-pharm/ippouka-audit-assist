/**
 * 処方箋の 1 行 → 施設の採用品（薬の鍵＝成分・規格・剤形で照合する）
 *
 * Next.js なしで動かせるように、値の import は "./makers.ts" だけ（拡張子つき。Node の --experimental-strip-types で読める）。
 * 親マスタ由来のデータ（lib/match-data.ts）と施設のマスタは引数で受け取る。
 *
 * 手順
 *  1. 処方箋の名前から、処方された薬の鍵を決める
 *     - 【般】（一般名処方）：一般名・剤形・規格を読み、親マスタの鍵から探す。
 *       口腔内崩壊錠＝OD、腸溶錠＝腸溶（YJ が腸溶の普通の名前の製品も）、腸溶性口腔内崩壊錠＝OD、徐放錠は補足（12時間／24時間）で L／CR を決める。
 *       決まらなければ鍵が複数のまま（候補を出すだけで自動では選ばない）
 *     - それ以外：販売名（メーカーを除いた名前も）を親マスタから探し、その製品の鍵。先発・後発も親マスタから
 *     - 親マスタに無い名前は、一般名と同じ読み方で鍵を推し量るが、候補を出すだけで自動では選ばない
 *  2. 施設の採用品を、決まり（data/match-profiles.json の施設ごとの決まり）でふるい分ける
 *     - 同じ鍵：選べる。処方が後発で採用品が先発、先発・後発の区別なし（別メーカー）なら処方どおりが既定で、候補に「事前合意（みなし疑義）があれば選択可」。施設の事前合意（options.agreements）に当たれば選べる
 *     - 普通の錠 → 同じ成分・規格の OD 錠：plain_to_od（院内は可、置き換えの表示）。OD → 普通の錠：od_to_plain（院内は不可）
 *     - カプセル ↔ 錠・OD 錠：capsule_tablet（院内は不可）
 *     - 放出の違い（CR と L、R と普通、腸溶と普通など）・規格の違い：どの決まりでも選ばない
 *     - 採用中止：販売終了は出さない。メーカー切替は「以前の採用」として別に返す（自動では選ばない）
 *  3. 結果：採用品／採用外（市販品あり：親マスタにはある）／該当なし
 */
import type { Tablet } from "./types";
import { brandLetterBase, releaseClass, strengthKey } from "./makers.ts";

/** 施設ごとの決まり（data/match-profiles.json） */
export type MatchProfile = {
  label: string;
  plain_to_od: boolean;
  od_to_plain: boolean;
  capsule_tablet: boolean;
  brand_to_generic: boolean;
  generic_to_brand: boolean;
  general_to_any: boolean;
  /** 先発→別の先発（併売品：ジャヌビア↔グラクティブ など）を自動で選ぶか。AKI が決めるまで false（候補にとどめる） */
  allow_brand_to_brand?: boolean;
  /** 事前合意を、普通錠→OD 錠の置き換え（YJ の上 9 桁が違う）と組み合わせてよいか。AKI が決めるまで false（合意は YJ の上 9 桁を越えない） */
  allow_agreement_cross_od?: boolean;
};
/** 自動では入れ替えない組（data/match-exceptions.json。効能・用法が違う） */
export type MatchException = { a: string; b: string; reason: string };
/** lib/match-data.ts（自動生成）の形 */
export type MatchData = {
  keys: string[];
  products: [string, number, number, string, string][];
  generics: Record<string, string>;
  profiles: Record<string, MatchProfile>;
  default_profile: string;
  general_release_notes: Record<string, string[]>;
  exceptions?: MatchException[];
};

/** 施設のマスタの 1 行（照合に使う欄だけ。data/master.json・data/rx-testset/facility.json） */
export type FacilityProduct = Pick<Tablet, "id" | "brand_name" | "generic_name" | "strength" | "adopted"> & {
  aliases?: string[];
  maker?: string | null;
  product_key?: string | null;
  drug_key?: string | null;
  maker_state?: string | null;
  discontinued_reason?: string | null; // 採用中止の理由：販売終了／メーカー切替
};

export type MatchStatus = "採用品" | "採用外（市販品あり）" | "該当なし";
export type Origin = "先発" | "後発" | "その他" | "不明";
/** 決まりで外した製品（「ルール外を表示（医師確認済み）」のときだけ返す） */
export type RuleOut<T> = { product: T; rule: string };

export type Match<T extends FacilityProduct = FacilityProduct> = {
  best: T | null;
  candidates: T[];
  substituted: boolean; // 処方箋の表記と違う採用品を選んだ（メーカー違い・先発→後発・普通の錠→OD 錠など）
  status: MatchStatus;
  /** 置き換えや決まらない理由など、表に出す一言 */
  note: string | null;
  /** 処方された薬の鍵（決まらなければ複数、親マスタに無ければ空） */
  keys: string[];
  origin: Origin;
  /** メーカー切替で採用をやめた製品（「以前の採用」。自動では選ばない） */
  previous: T[];
  /** 決まりで外した製品。options.includeRuleOut のときだけ入る */
  ruleOut: RuleOut<T>[];
  /** 事前合意で選んだとき、その合意 */
  agreement?: Agreement | null;
  /** 事前合意の一覧のうち、形が崩れていて使わなかった行（理由つき）。一覧を渡したときだけ */
  agreementErrors?: RejectedAgreement[];
};
export type RejectedAgreement = { index: number; row: unknown; reasons: string[] };

/**
 * 施設の事前合意（みなし疑義）。from（処方の製品名か薬の鍵）の処方に、to（採用品の id か販売名）を選んでよいと施設で決めたもの。
 * 後発→先発や先発・後発の区別なし（別メーカー）でも自動で選べるようになる。放出・カプセル↔錠・規格・YJ の上 9 桁の違い・入れ替えない組は越えない
 */
export type Agreement = { from: string; to: string; reason: string; agreed_by: string; agreed_at: string };

export type MatchOptions = {
  /** 施設の事前合意の一覧（data/private の施設ごとのファイル。架空の例は data/rx-testset/agreements.json） */
  agreements?: Agreement[];
  /** 処方箋の薬品名の後ろの補足（例：24時間持続）。徐放錠の一般名処方で L／CR を決めるのに使う */
  nameNote?: string | null;
  /** 施設ごとの決まりの名前（既定は data/match-profiles.json の default） */
  profile?: string | MatchProfile;
  /** 「ルール外を表示（医師確認済み）」：決まりで外した製品も ruleOut に返す（選ぶときは理由と変更者を記録する） */
  includeRuleOut?: boolean;
};

const ORIGIN: Origin[] = ["不明", "先発", "後発", "その他"];

/** 名前の比較用：NFKC、空白・® を除く、ハイフンの書き方をそろえる、小文字 */
export function nameKey(s: string | null | undefined): string {
  return (s ?? "").normalize("NFKC").replace(/[\s　®]/g, "").replace(/[‐‑‒–—−ー](?=[A-Za-z0-9])/g, "-").toLowerCase();
}
/** メーカー（「」）と括弧の補足を除いた名前 */
export function makerlessKey(s: string | null | undefined): string {
  return nameKey((s ?? "").normalize("NFKC").replace(/「[^」]*」|『[^』]*』/g, "").replace(/[（(][^）)]*[）)]/g, ""));
}
const stripPrefix = (s: string) => s.replace(/^(【般】|\[般\]|般|\(k\)|\(ca\)|\(na\)|\(mg\))/i, "");
const isGeneral = (s: string) => /^(【般】|\[般\]|般)/.test(s.normalize("NFKC").trim());

/** key：薬の鍵、canon：照合に使う鍵（ブランドの英字を普通の剤形にそろえたもの）、origin：先発・後発 */
type Hit = { key: string; canon: string; origin: Origin; yj9: string };
type Index = {
  byName: Map<string, Hit[]>;
  byMakerless: Map<string, Hit[]>;
  keysByGroupStrength: Map<string, string[]>;
  generics: [string, string][]; // [正規化した一般名, 成分・剤形コード]
  yj9ByKey: Map<string, Set<string>>; // 薬の鍵 → その鍵の製品の YJ の上 9 桁（YJ のあるものだけ）
  namesByKey: Map<string, string[]>; // 薬の鍵 → その鍵の製品の販売名（メーカーを除いた形）
  canonByKey: Map<string, Set<string>>; // 薬の鍵 → その鍵の製品の照合に使う鍵（ブランドの英字を普通にそろえたもの）
};
const cache = new WeakMap<MatchData, Index>();
function indexOf(data: MatchData): Index {
  const hit = cache.get(data);
  if (hit) return hit;
  const byName = new Map<string, Hit[]>();
  const byMakerless = new Map<string, Hit[]>();
  const add = (m: Map<string, Hit[]>, k: string, v: Hit) => {
    const list = m.get(k) ?? [];
    if (!list.some((x) => x.key === v.key && x.origin === v.origin && x.yj9 === v.yj9)) list.push(v);
    m.set(k, list);
  };
  const yj9ByKey = new Map<string, Set<string>>();
  const namesByKey = new Map<string, string[]>();
  const canonByKey = new Map<string, Set<string>>();
  for (const [name, ki, o, yj, yj9] of data.products) {
    const v = { key: data.keys[ki], canon: canonicalKey(data.keys[ki], yj), origin: ORIGIN[o] ?? "不明", yj9: yj9 ?? "" };
    if (yj9) yj9ByKey.set(v.key, new Set([...(yj9ByKey.get(v.key) ?? []), yj9]));
    namesByKey.set(v.key, [...(namesByKey.get(v.key) ?? []), makerlessKey(name)]);
    canonByKey.set(v.key, new Set([...(canonByKey.get(v.key) ?? []), v.canon]));
    add(byName, nameKey(name), v);
    add(byMakerless, makerlessKey(name), v);
  }
  const keysByGroupStrength = new Map<string, string[]>();
  for (const k of data.keys) {
    const [g, sk] = k.split("|");
    keysByGroupStrength.set(`${g}|${sk}`, [...(keysByGroupStrength.get(`${g}|${sk}`) ?? []), k]);
  }
  const generics = Object.entries(data.generics).map(([g, n]) => [genericKey(n), g] as [string, string]);
  const idx = { byName, byMakerless, keysByGroupStrength, generics, yj9ByKey, namesByKey, canonByKey };
  cache.set(data, idx);
  return idx;
}
const genericKey = (s: string) => nameKey(s).replace(/[・･\-]/g, "");

/**
 * 照合に使う鍵。剤形が「一覧に無い英字＋土台」（アルダクトンA錠、チラーヂンS錠、ガスロンN錠など）で、
 * YJ の 8 桁目が普通の製剤（F 錠・M カプセル）と示すときだけ、土台の剤形の鍵にそろえる（アルダクトンA → スピロノラクトン錠と同じ）。
 * YJ が無い・徐放などを示すときはそのまま（迷ったら分ける）。規格の後ろの英字（MT・TRE・AD など、効能違いの印）はそろえない
 */
export function canonicalKey(key: string, yjChar: string | null | undefined): string {
  const { group, sk, form, yj } = splitKey(key);
  if (yj || !yjChar || !/^[FM]$/.test(yjChar)) return key;
  const base = brandLetterBase(form);
  return base ? `${group}|${sk}|${base}` : key;
}

/** 鍵を部分に分ける（成分・剤形コード|規格|剤形|YJ の手がかり） */
function splitKey(k: string) {
  const [group, sk, form, yj = ""] = k.split("|");
  return { group, sk, form, yj };
}
const isCapsule = (form: string) => form.includes("カプセル");
const PLAIN = new Set(["錠", "OD錠", "カプセル"]);

/** 処方された鍵 p と採用品の鍵 f の関係 */
/** 剤形から製品の系列（〔アダラート〕）と規格の後ろの英字（/MI）を除いたもの＝放出の印と土台だけ */
const releaseType = (form: string) => form.replace(/〔[^〕]*〕/, "").replace(/\/[A-Za-z]+$/, "");
function relation(p: string, f: string): "same" | "plain_to_od" | "od_to_plain" | "capsule_tablet" | "release" | "release_family" | "strength" | "other" {
  if (p === f) return "same";
  const a = splitKey(p), b = splitKey(f);
  if (a.group.slice(0, 7) !== b.group.slice(0, 7)) return "other";
  if (a.sk !== b.sk) return "strength";
  // 放出の印は同じで、製品の系列（〔〕）か規格の後ろの英字だけが違う（アダラートCR と ニフェジピンCR、デパケンR と セレニカR）
  if (a.yj === b.yj && a.form !== b.form && releaseType(a.form) === releaseType(b.form)) return "release_family";
  if (a.yj || b.yj || !PLAIN.has(a.form) || !PLAIN.has(b.form)) return "release";
  if (isCapsule(a.form) !== isCapsule(b.form)) return "capsule_tablet";
  if (a.form === "錠" && b.form === "OD錠") return "plain_to_od";
  if (a.form === "OD錠" && b.form === "錠") return "od_to_plain";
  return "release";
}
const RULE_LABEL: Record<string, string> = {
  plain_to_od: "普通の錠の処方を OD 錠に",
  od_to_plain: "OD 錠の処方を普通の錠に",
  capsule_tablet: "カプセルと錠の入れ替え",
  generic_to_brand: "後発品の処方を先発品に",
  release: "放出の仕方が違う（徐放・腸溶など）",
  release_family: "放出の印は同じだが製剤の系列が違う（YJ の上 9 桁が違う、または先発→後発でない）",
  strength: "規格が違う",
};

/**
 * 一般名処方（【般】…）の鍵。一般名・規格・剤形で親マスタの鍵を探す。決まらなければ複数
 * 例：【般】アムロジピン口腔内崩壊錠5mg → 2171022F|5|OD錠、【般】ニフェジピン徐放錠20mg＋24時間持続 → CR 錠の鍵
 */
export function generalNameKeys(name: string, strength: string | null | undefined, nameNote: string | null | undefined, data: MatchData): string[] {
  return generalName(name, strength, nameNote, data).keys;
}
/** decided：補足（12時間／24時間）で放出の型が 1 つに決まった（L 錠・CR 錠の系列が違っても同じ型として扱う） */
function generalName(name: string, strength: string | null | undefined, nameNote: string | null | undefined, data: MatchData): { keys: string[]; decided: boolean; kind?: string } {
  const idx = indexOf(data);
  const n = stripPrefix(name.normalize("NFKC").trim());
  const sk = strengthKey(strength ?? n.match(/(\d+(?:\.\d+)?)\s*(mg|μg|µg|ug|g)/i)?.[0] ?? "");
  const m = n.match(/^(.*?)(腸溶性口腔内崩壊錠|口腔内崩壊錠|徐放錠|腸溶錠|OD錠|チュアブル錠|舌下錠|速崩錠|分散錠|粒状錠|バッカル錠|錠|徐放カプセル|腸溶カプセル|カプセル)/);
  if (!m || !sk) return { keys: [], decided: false, kind: m?.[2] };
  const stem = genericKey(m[1]);
  const kind = m[2];
  // 規格の後ろの英字（MT・ZA・AV・RE・AD・EX・TRE など、効能・用法の違う系列の印）。「250mgMT」「5mg（ZA）」の形
  const suffix = n.slice(m[0].length).match(/\d\s*(?:mg|μg|µg|g)?\s*[（(]?([A-Z]{2,4})[）)]?\s*$/)?.[1] ?? "";
  if (stem.length < 2) return { keys: [], decided: false, kind };
  // 一般名（親マスタの成分名）がこの名前で始まるもの（アムロジピン → アムロジピンベシル酸塩）。完全に同じものがあればそれだけ
  const exact = idx.generics.filter(([g]) => g === stem);
  const groups = new Set((exact.length ? exact : idx.generics.filter(([g]) => g.startsWith(stem) && !/配合/.test(g))).map(([, grp]) => grp));
  let keys = [...groups].flatMap((g) => idx.keysByGroupStrength.get(`${g}|${sk}`) ?? []);
  const f = (k: string) => splitKey(k);
  let decided = false;
  const capsule = kind.includes("カプセル");
  keys = keys.filter((k) => isCapsule(f(k).form) === capsule);
  // 英字の無い口腔内崩壊錠の一般名は、英字（TRE・ZA など）の無い OD 錠だけ（英字つきは下で）
  if (kind === "口腔内崩壊錠" || kind === "腸溶性口腔内崩壊錠" || kind === "OD錠") keys = keys.filter((k) => f(k).form === "OD錠" && !f(k).yj);
  // 腸溶・徐放の一般名は、放出の印（form-markers.json の release）か YJ の腸溶・徐放のある製品だけ。
  // 規格の後ろの英字（MT・NX など）・粒状・分散・速崩・バッカル・チュアブル・OD は放出の印ではないので当てない
  else if (kind === "腸溶錠" || kind === "腸溶カプセル") keys = keys.filter((k) => releaseClass(f(k).form) === "腸溶" || f(k).yj === "YJ腸溶");
  else if (kind === "徐放錠" || kind === "徐放カプセル") {
    keys = keys.filter((k) => (releaseClass(f(k).form) === "徐放" || f(k).yj === "YJ徐放") && !/OD/.test(f(k).form.replace(/〔[^〕]*〕/, "")));
    // 「12～24時間持続」（テオフィリンなど）は放出の型を決めない補足として扱う（12時間・24時間の決まりに当てない）
    const note = ((nameNote ?? "").normalize("NFKC") + n.slice(m[0].length)).replace(/\d+\s*[～〜~\-ー]\s*\d+\s*時間/g, "");
    for (const [word, markers] of Object.entries(data.general_release_notes)) {
      if (!note.includes(word)) continue;
      keys = keys.filter((k) => markers.some((mk) => new RegExp(`^${mk}(錠|カプセル)〔`).test(f(k).form)));
      decided = keys.length > 0 && new Set(keys.map((k) => f(k).form.replace(/〔[^〕]*〕/, ""))).size === 1;
    }
  } else if (["チュアブル錠", "舌下錠", "速崩錠", "分散錠", "粒状錠", "バッカル錠"].includes(kind)) {
    // 剤形の名前がそのまま印になっているもの（舌下錠/JAU のような規格の後ろの英字つきは、英字があるときだけ）
    const re = new RegExp(`^${kind}(〔[^〕]*〕)?${suffix ? `/${suffix}` : ""}$`);
    keys = keys.filter((k) => re.test(f(k).form) && !f(k).yj);
  } else {
    // 普通の錠・カプセル。ブランドの英字（チラーヂンS錠、エルカルチンFF錠）は YJ が普通の製剤なら普通と同じ（canonicalKey）
    const base = capsule ? "カプセル" : "錠";
    const plain = (k: string) => !f(k).yj && (f(k).form === base || [...(idx.canonByKey.get(k) ?? [])].every((c) => splitKey(c).form === base));
    keys = keys.filter((k) => (suffix ? f(k).form === `${base}/${suffix}` : plain(k)));
  }
  // 口腔内崩壊錠の一般名に英字（TRE・ZA など）があれば、その英字の鍵だけ
  if (suffix && (kind === "口腔内崩壊錠" || kind === "OD錠")) {
    keys = [...groups].flatMap((g) => idx.keysByGroupStrength.get(`${g}|${sk}`) ?? []).filter((k) => f(k).form === `OD錠/${suffix}`);
  }
  return { keys: [...new Set(keys)].sort(), decided, kind };
}

/** 処方箋の名前から、処方された薬の鍵と先発・後発。general：一般名処方。found：親マスタに名前があった */
export function prescribedKeys(name: string, strength: string | null | undefined, nameNote: string | null | undefined, data: MatchData) {
  const idx = indexOf(data);
  if (isGeneral(name)) {
    const { keys, decided, kind } = generalName(name, strength, nameNote, data);
    // 照合に使う鍵：ブランドの英字の鍵（チラーヂンS錠）は、YJ が普通の製剤なら普通の錠の鍵にそろえる
    const cmap = indexOf(data).canonByKey;
    const canon = [...new Set(keys.map((k) => { const c = cmap.get(k); return c && c.size === 1 ? [...c][0] : k; }))];
    return { keys, canon, origin: "不明" as Origin, general: true, found: keys.length > 0, decided, yj9: "", kind: kind ?? "" };
  }
  const n = stripPrefix(name.normalize("NFKC").trim());
  const tries = [nameKey(n), nameKey(n + (strength ?? ""))];
  for (const t of tries) {
    const hit = idx.byName.get(t);
    if (hit) return fromHits(hit);
  }
  for (const t of [makerlessKey(n), makerlessKey(n + (strength ?? ""))]) {
    const hit = idx.byMakerless.get(t);
    if (hit) return fromHits(hit);
  }
  // 親マスタに無い名前：一般名と同じ読み方で鍵を推し量る（自動では選ばない）
  const guess = generalNameKeys(n.replace(/「[^」]*」/g, ""), strength, nameNote, data);
  return { keys: guess, canon: guess, origin: "不明" as Origin, general: false, found: false, decided: false, yj9: "", kind: "" };
}
const fromHits = (hit: Hit[]) => {
  const yj9 = [...new Set(hit.map((x) => x.yj9))];
  return { keys: [...new Set(hit.map((x) => x.key))], canon: [...new Set(hit.map((x) => x.canon))], origin: oneOrigin(hit), general: false, found: true, decided: false, yj9: yj9.length === 1 ? yj9[0] : "", kind: "" };
};
const oneOrigin = (list: { origin: Origin }[]): Origin => {
  const s = new Set(list.map((x) => x.origin));
  return s.size === 1 ? [...s][0] : "不明";
};

/** 施設の 1 行の鍵（drug_key → 販売名 → 別名の順に親マスタから） */
export function facilityKey(p: FacilityProduct, data: MatchData): string | null {
  if (p.drug_key) return p.drug_key;
  const idx = indexOf(data);
  for (const n of [p.product_key, p.brand_name, ...(p.aliases ?? [])]) {
    const hit = n ? idx.byName.get(nameKey(n)) : undefined;
    if (hit && new Set(hit.map((x) => x.key)).size === 1) return hit[0].key;
  }
  return null;
}
/** 施設の 1 行の、照合に使う鍵（canonicalKey。YJ は施設の行の yj_code か、親マスタの同じ名前の製品から） */
export function facilityCanon(p: FacilityProduct & { yj_code?: string | null }, data: MatchData): string | null {
  const fk = facilityKey(p, data);
  if (!fk) return null;
  const g = fk.split("|")[0];
  if (p.yj_code && p.yj_code.slice(0, 7) === g.slice(0, 7)) return canonicalKey(fk, p.yj_code[7]);
  const idx = indexOf(data);
  for (const n of [p.product_key, p.brand_name]) {
    const hit = n ? idx.byName.get(nameKey(n))?.find((x) => x.key === fk) : undefined;
    if (hit) return hit.canon;
  }
  return fk;
}
/** 施設の 1 行の YJ の上 9 桁（施設の行の yj_code か、親マスタの同じ名前の製品から。分からなければ ""） */
export function facilityYj9(p: FacilityProduct & { yj_code?: string | null }, data: MatchData): string {
  const fk = facilityKey(p, data);
  if (!fk) return "";
  const g = fk.split("|")[0];
  // 親マスタの同じ名前の製品（統一名の取り違えを直した YJ）を先に使い、無ければ施設の行の yj_code
  const idx = indexOf(data);
  for (const n of [p.product_key, p.brand_name]) {
    const hits = n ? (idx.byName.get(nameKey(n)) ?? []).filter((x) => x.key === fk) : [];
    const s = new Set(hits.map((x) => x.yj9));
    if (hits.length) return s.size === 1 ? [...s][0] : "";
  }
  if (p.yj_code && p.yj_code.length >= 9 && p.yj_code.slice(0, 7) === g.slice(0, 7)) return p.yj_code.slice(0, 9);
  return "";
}
/** data/match-exceptions.json の組に当たるか（販売名からメーカーを除いた頭で、両方向） */
export function exceptionOf(prescribed: string, product: string, data: MatchData): MatchException | null {
  const a = makerlessKey(stripPrefix(prescribed.normalize("NFKC").trim())), b = makerlessKey(product);
  for (const e of data.exceptions ?? []) {
    const x = nameKey(e.a), y = nameKey(e.b);
    if ((a.startsWith(x) && b.startsWith(y)) || (a.startsWith(y) && b.startsWith(x))) return e;
  }
  return null;
}
/**
 * 事前合意の一覧を確かめる。from・to・reason・agreed_by・agreed_at がそろい（空白だけは空とみなす）、agreed_at が YYYY-MM-DD の
 * 実在の日付の行だけを使う。使わない行は理由つきで返す（画面・確認係が知らせるため）。配列でない一覧・null の行でも落ちない
 */
export function validateAgreements(list: unknown): { valid: Agreement[]; rejected: RejectedAgreement[] } {
  const valid: Agreement[] = [];
  const rejected: RejectedAgreement[] = [];
  if (!Array.isArray(list)) {
    if (list != null) rejected.push({ index: -1, row: list, reasons: ["一覧が配列でない"] });
    return { valid, rejected };
  }
  list.forEach((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      rejected.push({ index, row, reasons: ["行がオブジェクトでない"] });
      return;
    }
    const r = row as Record<string, unknown>;
    const reasons: string[] = [];
    for (const k of ["from", "to", "reason", "agreed_by", "agreed_at"]) {
      if (typeof r[k] !== "string" || !(r[k] as string).trim()) reasons.push(`${k} が無い・空`);
    }
    if (typeof r.agreed_at === "string" && r.agreed_at.trim()) {
      const d = r.agreed_at.trim();
      const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      const t = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
      if (!m || !t || t.getUTCFullYear() !== +m[1] || t.getUTCMonth() !== +m[2] - 1 || t.getUTCDate() !== +m[3]) reasons.push(`agreed_at が日付（YYYY-MM-DD）でない：${d}`);
    }
    if (reasons.length) rejected.push({ index, row, reasons });
    else valid.push({ from: (r.from as string).trim(), to: (r.to as string).trim(), reason: (r.reason as string).trim(), agreed_by: (r.agreed_by as string).trim(), agreed_at: (r.agreed_at as string).trim() });
  });
  return { valid, rejected };
}

/** 事前合意の一覧から、この処方（名前か薬の鍵）とこの採用品に当たるものを探す */
export function agreementOf(list: Agreement[] | undefined, prescribed: string, keys: string[], product: FacilityProduct): Agreement | null {
  if (!list?.length) return null;
  const w = nameKey(stripPrefix(prescribed.normalize("NFKC").trim()));
  const wl = makerlessKey(stripPrefix(prescribed.normalize("NFKC").trim()));
  for (const a of list) {
    const fromHit = nameKey(a.from) === w || keys.includes(a.from) || (!/「/.test(a.from) && makerlessKey(a.from) === wl);
    const toHit = a.to === product.id || nameKey(a.to) === nameKey(product.brand_name) || (!!product.product_key && nameKey(a.to) === nameKey(product.product_key));
    if (fromHit && toHit) return a;
  }
  return null;
}
/** 規格が数量でない（「1錠」など）か、漢方製剤（YJ 52）。メーカーが違えば中身が違うので、同じ鍵でも同じ薬とみなさない */
const notInterchangeable = (key: string) => {
  const { group, sk } = splitKey(key);
  return group.startsWith("52") || !/\d/.test(sk) || /錠|カプセル|包|個|枚/.test(sk);
};
export function facilityOrigin(p: FacilityProduct, data: MatchData): Origin {
  const idx = indexOf(data);
  for (const n of [p.product_key, p.brand_name]) {
    const hit = n ? idx.byName.get(nameKey(n)) : undefined;
    if (hit) return oneOrigin(hit);
  }
  return "不明";
}

export function profileOf(data: MatchData, p?: string | MatchProfile): MatchProfile {
  if (p && typeof p === "object") return p;
  const prof = data.profiles[p ?? data.default_profile];
  if (!prof) throw new Error(`施設の決まり「${p}」がありません`);
  return prof;
}

/** 処方箋の 1 行を施設の採用品と照合する */
export function matchRx<T extends FacilityProduct>(
  nameAsWritten: string,
  strength: string | null | undefined,
  facility: T[],
  data: MatchData,
  options: MatchOptions = {},
): Match<T> {
  const prof = profileOf(data, options.profile);
  const written = nameKey(nameAsWritten);
  const writtenNoPrefix = nameKey(stripPrefix(nameAsWritten.normalize("NFKC").trim()));
  const rx = prescribedKeys(nameAsWritten, strength, options.nameNote, data);
  const out: Match<T> = { best: null, candidates: [], substituted: false, status: "該当なし", note: null, keys: rx.keys, origin: rx.origin, previous: [], ruleOut: [] };

  const active = facility.filter((p) => p.adopted);
  const switched = facility.filter((p) => !p.adopted && p.discontinued_reason !== "販売終了");
  const sameName = (p: T) => [p.brand_name, ...(p.aliases ?? [])].some((a) => nameKey(a) === written || nameKey(a) === writtenNoPrefix);

  // 処方箋の名前と同じ採用品（別名を含む）。鍵が親マスタに無い製品（アスパラ-CA など）もここで選べる
  const exact = active.filter(sameName);
  out.previous = switched.filter((p) => sameName(p) || (!!facilityCanon(p, data) && rx.canon.includes(facilityCanon(p, data)!)));

  // 鍵で照合して、決まりでふるい分ける。candOnly：候補には出すが自動では選ばない（理由つき）
  const allowed: { p: T; rel: string; candOnly: string | null }[] = [];
  const agreed = new Map<T, Agreement>();
  const checked = options.agreements === undefined ? null : validateAgreements(options.agreements);
  const agreements = checked?.valid ?? [];
  if (checked?.rejected.length) out.agreementErrors = checked.rejected;
  for (const p of active) {
    const fk = facilityCanon(p, data);
    if (!fk || !rx.canon.length) continue;
    const rels = rx.canon.map((k) => relation(k, fk));
    let rel: string = rels.includes("same") ? "same" : rels.includes("plain_to_od") ? "plain_to_od" : rels.includes("release_family") ? "release_family" : rels.find((r) => r !== "other") ?? "other";
    if (rel === "other") continue;
    const fo = facilityOrigin(p, data);
    // 放出の印が同じで系列だけ違う：先発→後発で YJ の上 9 桁（成分・剤形・規格）が同じときだけ同じ薬（アダラートCR → ニフェジピンCR「サワイ」）。
    // デパケンR とセレニカR のような先発どうし、後発→先発、YJ が分からないときは分けたまま
    if (rel === "release_family" && !rx.general && rx.origin === "先発" && fo === "後発" && rx.yj9 && rx.yj9 === facilityYj9(p, data)) rel = "same_yj";
    else if (rel === "release_family" && !rx.general && rx.origin === "後発" && fo === "先発" && rx.yj9 && rx.yj9 === facilityYj9(p, data)) rel = "same_yj"; // 後発→先発：下で事前合意があれば選べる候補に
    let rule: string | null = null;
    let candOnly: string | null = null;
    let originHold: string | null = null; // 先発・後発の決まりで候補にとどめる理由（事前合意で外せる）
    if (rel === "same" || rel === "same_yj" || rel === "plain_to_od") {
      if (rel === "plain_to_od" && !prof.plain_to_od) rule = rel;
      else if (rx.general) rule = prof.general_to_any ? null : "general_to_any";
      // 先発・後発：自動で選ぶのは、採用品が後発のとき（先発→後発は brand_to_generic）と、先発→先発のとき（allow_brand_to_brand）。
      // 後発→先発・先発後発の区別なし（別メーカー）は、処方どおりが既定で、候補に「事前合意（みなし疑義）があれば選択可」と出す。
      // 施設の事前合意（options.agreements）に当たれば自動で選べる。先発・後発が分からないときも候補にとどめる
      else if (rx.origin === "後発" && fo === "先発") originHold = prof.generic_to_brand ? null : "後発品の処方を先発品に：事前合意（みなし疑義）があれば選択可";
      else if (fo === "後発") rule = rx.origin === "先発" && !prof.brand_to_generic ? "brand_to_generic" : null;
      else if (fo === "先発" && rx.origin === "先発") rule = null;
      else if (rx.origin === "不明" || fo === "不明") originHold = `先発・後発が分からない（処方 ${rx.origin}・採用品 ${fo}）：要確認`;
      else originHold = "先発・後発の区別なし（別メーカー）：事前合意（みなし疑義）があれば選択可";
      if (!rule && !candOnly && notInterchangeable(fk)) candOnly = "漢方製剤・規格が数量でない製剤は、メーカーが違えば同じ薬とみなさない：要確認";
      // 一般名処方：一般名が指す鍵の製品に YJ の上 9 桁の違う製剤が混ざる（効能・用法が違うことがある：タダラフィル 5mg のザルティアとシアリス、
      // トラマドール徐放のワントラムとツートラム）、採用品がその 9 桁に入らない・分からない、採用品が入れ替えない組の製品なら、候補にとどめる
      if (!rule && !candOnly && rx.general) {
        const idx = indexOf(data);
        // 規格の後ろの英字（MT・ZA など）つきの鍵にもある 9 桁は、その英字の系列（メトグルコ→MT）。英字の無い一般名からは外す
        const suffixed = new Set(rx.keys.flatMap((k) => {
          const { group, sk, form } = splitKey(k);
          return (idx.keysByGroupStrength.get(`${group}|${sk}`) ?? []).filter((x) => splitKey(x).form.startsWith(form + "/")).flatMap((x) => [...(idx.yj9ByKey.get(x) ?? [])]);
        }));
        const groups = new Set(rx.keys.flatMap((k) => [...(idx.yj9ByKey.get(k) ?? [])]).filter((y) => !suffixed.has(y)));
        const fy = facilityYj9(p, data);
        // 入れ替えない組：採用品が組の片方で、もう片方が同じ鍵にある（一般名だけではどちらか決まらない）
        const names = rx.keys.flatMap((k) => idx.namesByKey.get(k) ?? []);
        const mine = makerlessKey(p.brand_name);
        const inEx = (data.exceptions ?? []).some((e) =>
          [[e.a, e.b], [e.b, e.a]].some(([x, y]) => mine.startsWith(nameKey(x)) && names.some((n) => n.startsWith(nameKey(y)))));
        if (inEx) candOnly = "一般名処方：採用品が効能・用法の違う製品のある組（入れ替えない組）に入る：要確認";
        else if (groups.size > 1) candOnly = "一般名処方：同じ成分・規格・剤形に YJ の上 9 桁の違う製剤がある（効能・用法が違うことがある）：要確認";
        else if (rel !== "plain_to_od" && groups.size === 1 && (!fy || !groups.has(fy))) candOnly = "一般名処方：採用品の YJ の上 9 桁が一般名の製剤と違う（または分からない）：要確認";
      }
      // 自動では入れ替えない組（data/match-exceptions.json）。理由をいちばん先に出す
      if (!rule && !rx.general) {
        const ex = exceptionOf(nameAsWritten, p.brand_name, data);
        if (ex) candOnly = `自動では入れ替えない組：${ex.reason}`;
      }
      // 別の製品を自動で選ぶのは、YJ の上 9 桁（成分・剤形・規格）が同じときだけ（普通錠→OD 錠の置き換えと一般名処方を除く）。
      // 鍵が同じでも YJ が違えば効能・用法の違う製剤のことがある（ワントラム↔ツートラム、メトグルコ→グリコランの後発）
      if (!rule && !candOnly && !rx.general && rel !== "plain_to_od") {
        const fy = facilityYj9(p, data);
        if (!rx.yj9 || !fy) candOnly = "YJ コードが分からない：効能・用法が同じか要確認";
        else if (rx.yj9 !== fy) candOnly = "YJ の上 9 桁が違う：効能・用法が違う製剤の可能性。要確認";
      }
      if (!rule && !candOnly && !rx.general && rx.origin === "先発" && fo === "先発") {
        if (!prof.allow_brand_to_brand) candOnly = "先発品から別の先発品（併売品など）：要確認";
        else if (rel === "plain_to_od") candOnly = "先発品から別の先発品の OD 錠：YJ の上 9 桁が違うので要確認";
      }
      // 先発・後発の決まりは、ほかの決まり（放出・規格・YJ・入れ替えない組・漢方）に当たらないときだけ。事前合意があれば外す
      if (!rule && !candOnly && originHold) {
        const ag = agreementOf(agreements, nameAsWritten, rx.keys, p);
        // 合意は YJ の上 9 桁を越えない：普通錠→OD 錠の置き換え（9 桁が違う）とは組み合わせない（allow_agreement_cross_od で変えられる）
        if (ag && rel === "plain_to_od" && !prof.allow_agreement_cross_od) candOnly = `${originHold}（事前合意は普通錠→OD 錠の置き換えには使わない）`;
        else if (ag) agreed.set(p, ag);
        else candOnly = originHold;
      }

    } else if (rel === "od_to_plain") rule = prof.od_to_plain ? null : rel;
    else if (rel === "capsule_tablet") rule = prof.capsule_tablet ? null : rel;
    else rule = rel; // 放出・規格の違いは選ばない
    if (rule) {
      if (options.includeRuleOut) out.ruleOut.push({ product: p, rule: RULE_LABEL[rule] ?? rule });
    } else allowed.push({ p, rel, candOnly });
  }

  const ambiguousSpec = rx.canon.length > 1 && !rx.decided;
  const ambiguousNote = /徐放/.test(rx.kind)
    ? "徐放製剤の型（1 日の回数など）が名前だけでは決まりません（補足の 12時間／24時間 などを確かめてください）"
    : /腸溶/.test(rx.kind)
      ? "腸溶製剤が名前だけでは 1 つに決まりません。製品を確かめてください"
      : "処方の剤形・放出が名前だけでは決まりません。製品を確かめてください";
  const pickFrom = (list: { p: T; candOnly: string | null }[]) => {
    const auto = list.filter((x) => !x.candOnly);
    return auto.length === 1 && rx.found && !ambiguousSpec ? auto[0].p : null;
  };
  if (exact.length) {
    out.candidates = exact;
    out.best = exact.length === 1 ? exact[0] : null;
  } else {
    const same = allowed.filter((x) => x.rel === "same" || x.rel === "same_yj");
    const sub = allowed.filter((x) => x.rel !== "same" && x.rel !== "same_yj");
    const tier = same.length ? same : sub;
    out.candidates = (ambiguousSpec ? allowed : tier).map((x) => x.p);
    out.best = pickFrom(tier);
    const chosen = allowed.find((x) => x.p === out.best);
    if (chosen && chosen.rel !== "same" && chosen.rel !== "same_yj") out.note = `置き換え：${RULE_LABEL[chosen.rel]}`;
    else if (chosen?.rel === "same_yj") out.note = "置き換え：先発品の処方を後発品に（YJ の上 9 桁が同じ）";
    else if (out.best && !rx.general && rx.origin === "先発" && facilityOrigin(out.best, data) === "後発") out.note = "置き換え：先発品の処方を後発品に";
    if (out.best && agreed.has(out.best)) {
      const ag = agreed.get(out.best)!;
      out.agreement = ag;
      out.note = `事前合意：${ag.reason}（${ag.agreed_by} ${ag.agreed_at}）`;
    }
    if (!out.best && !ambiguousSpec) {
      const why = tier.find((x) => x.candOnly)?.candOnly;
      if (why) out.note = why;
    }
  }
  if (out.best) {
    const b = out.best;
    if (nameKey(b.brand_name) === written || nameKey(b.brand_name) === writtenNoPrefix) out.substituted = false;
    else if ((b.aliases ?? []).some((x) => nameKey(x) === written || nameKey(x) === writtenNoPrefix)) out.substituted = !sameMaker(nameAsWritten, b); // 同じメーカーの表記ゆれは置き換えではない
    else out.substituted = true;
  }
  if (out.note && !out.best) { /* 候補にとどめた理由（先発・後発・漢方など）を優先する */ }
  else if (!out.best && out.candidates.length > 1) out.note = ambiguousSpec ? ambiguousNote : "採用品の候補が複数あります。選んでください";
  else if (!out.best && out.candidates.length === 1 && !rx.found) out.note = "処方箋の名前が親マスタにありません。候補を確かめて選んでください";
  else if (!out.best && out.candidates.length === 1 && ambiguousSpec) out.note = ambiguousNote;
  out.status = out.best || out.candidates.length ? "採用品" : rx.keys.length || out.previous.length ? "採用外（市販品あり）" : "該当なし";
  if (out.status === "採用外（市販品あり）" && !out.note) out.note = out.previous.length ? "以前の採用品があります（メーカー切替）。今は採用していません" : "親マスタには製品がありますが、施設では採用していません";
  return out;
}
function sameMaker(written: string, p: FacilityProduct): boolean {
  const w = written.normalize("NFKC").match(/[「『]([^」』]*)[」』]/)?.[1];
  const m = p.brand_name.normalize("NFKC").match(/[「『]([^」』]*)[」』]/)?.[1] ?? p.maker ?? "";
  return !!w && nameKey(w) === nameKey(m);
}

/** 「ルール外を表示（医師確認済み）」で選んだときの記録。理由と変更者が無ければエラー（保存はまだしない） */
export type RuleOverrideRecord = {
  name_as_written: string;
  product_id: string;
  rule: string;
  reason: string;
  changed_by: string;
  changed_at: string;
};
export function buildRuleOverrideRecord(args: { name_as_written: string; product: FacilityProduct; rule: string; reason: string; changed_by: string; at?: Date }): RuleOverrideRecord {
  const reason = args.reason.trim();
  const by = args.changed_by.trim();
  if (!reason) throw new Error("ルール外を選ぶ理由を入れてください（例：医師に確認済み）");
  if (!by) throw new Error("変更者を入れてください");
  return { name_as_written: args.name_as_written, product_id: args.product.id, rule: args.rule, reason, changed_by: by, changed_at: (args.at ?? new Date()).toISOString() };
}

/** 施設の行のうち、同じ薬（drug_key）でメーカー切替で採用をやめた製品の product_key（メーカー選択の「以前の採用」の札） */
export function previousProductKeys(drug: string | null | undefined, facility: FacilityProduct[], data: MatchData): Set<string> {
  if (!drug) return new Set();
  return new Set(
    facility.filter((p) => !p.adopted && p.discontinued_reason === "メーカー切替" && facilityKey(p, data) === drug).map((p) => p.product_key ?? p.brand_name),
  );
}

