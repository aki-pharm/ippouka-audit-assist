/**
 * 画面に出す短い文字（刻印・製品の呼び名・図の名前）。薬剤師が 1 日に何度も見るので、見分けに役立つものだけを短く出す。
 * React に依存しない純粋な関数（照合・安全の判断には使わない。表示だけ）
 */

type Named = { brand_name: string; generic_name?: string | null; maker?: string | null };
type WithImprint = Named & { imprint_front: string; imprint_back: string };

/** かな・漢字（「・」「ー」だけのものは数えない） */
const JA = /[ぁ-ゖァ-ヺ一-鿿々]/;
const JA_ALL = /[ぁ-ゖァ-ヺー一-鿿々]+/g;

export type ImprintKind = "name" | "code" | "none" | "unverified";

function nfkc(s: string | null | undefined): string {
  return (s ?? "").normalize("NFKC").replace(/[\s　]/g, "");
}

/**
 * 刻印の種類。
 *  name：成分名・販売名・メーカー名をかな・漢字で書いた印字（「ラベプラ 10 オーハラ」「クロピドグレル 75 トーワ」）。文字を出さず「名前印字」で足りる
 *  code：記号・番号（「SW NF CR10」「TV10」「586」「NVR」）。見分けに使うので出す
 *  none：「なし」　unverified：「未確認」・空
 * かな・漢字があっても、販売名・一般名・メーカー名のどれにも当たらないもの（例：名前と関係のない語）は code として出す
 */
export function imprintKind(imprint: string | null | undefined, p: Named): ImprintKind {
  const s = (imprint ?? "").trim();
  if (!s || s === "未確認") return "unverified";
  if (s === "なし") return "none";
  if (!JA.test(s)) return "code";
  const names = nfkc(`${p.brand_name}${p.generic_name ?? ""}${p.maker ?? ""}`);
  // 2 文字以上のかな・漢字の語だけを見る（「1番」の「番」などは見ない）
  const words = (nfkc(s).match(JA_ALL) ?? []).filter((w) => JA.test(w) && [...w].length >= 2);
  if (!words.length) return "code";
  return words.every((w) => names.includes([...w].slice(0, 2).join(""))) ? "name" : "code";
}

/**
 * 刻印の見せ方（一覧・図の共通）。
 *  front：表に出す文字（name・なし・未確認のときは null）。nameTag：「名前印字」の札を出すか。frontUnverified：表が未確認か
 *  back：裏に出す文字。表と同じ・名前印字・未確認なら出さない。「なし」は表が記号のときだけ「なし」を出す
 */
export function imprintDisplay(p: WithImprint): { front: string | null; nameTag: boolean; frontUnverified: boolean; back: string | null } {
  const fk = imprintKind(p.imprint_front, p);
  const bk = imprintKind(p.imprint_back, p);
  const same = nfkc(p.imprint_front) === nfkc(p.imprint_back);
  let back: string | null = null;
  if (bk === "code" && !same) back = p.imprint_back.trim();
  else if (bk === "none" && fk === "code") back = "なし";
  return { front: fk === "code" ? p.imprint_front.trim() : null, nameTag: fk === "name", frontUnverified: fk === "unverified", back };
}

/** 一覧の 1 行の刻印（例：「SW NF CR10／裏 なし」「名前印字／裏 15」「刻印 未確認」）。表も裏も無ければ空 */
export function imprintSummary(p: WithImprint): string {
  const d = imprintDisplay(p);
  const head = d.front ?? (d.nameTag ? "名前印字" : d.frontUnverified ? "刻印 未確認" : "");
  if (!d.back) return head;
  return head ? `${head}／裏 ${d.back}` : `裏 ${d.back}`;
}

/** 販売名が旧製品か（同じメーカー・同じ名前で、YJ コードの違う前の製品） */
export function isOldProduct(brand: string): boolean {
  return /[（(]旧製品[）)]/.test(brand.normalize("NFKC"));
}

const SALT = /(塩酸|臭化水素酸|硫酸|リン酸|酢酸|コハク酸|クエン酸|フマル酸|マレイン酸|酒石酸|メシル酸|ベシル酸|トシル酸|乳酸|硝酸)塩$/;

/**
 * 図のカードの名前を、成分（販売名の頭）と規格に分ける。「」のメーカー・（）の補足・「錠」・塩の名前は出さない。
 * 例：「シベンゾリンコハク酸塩錠50mg「サワイ」」→ { base: "シベンゾリン", strength: "50mg" }、「アムロジピンOD錠10mg「武田テバ」」→ { base: "アムロジピンOD", strength: "10mg" }
 */
export function cardName(brand: string): { base: string; strength: string } {
  const s = brand.normalize("NFKC").replace(/「[^」]*」/g, "").replace(/\([^)]*\)/g, "").trim();
  const m = s.match(/^(.*?)(錠|カプセル|ゼリー)(.*)$/);
  if (!m) return { base: s, strength: "" };
  return { base: m[1].replace(SALT, "") || m[1], strength: m[3].trim() };
}

/**
 * 一覧の製品の呼び名：販売名の「」のメーカー（旧製品は「（旧製品）」をつける）。
 * 「」が無い製品（先発品など）は販売名の頭に、メーカー欄があればそれを、無ければ「（先発）」を添える（例：「パリエット（先発）」）
 */
export function productLabel(p: Named): string {
  const n = p.brand_name.normalize("NFKC");
  const old = isOldProduct(n) ? "（旧製品）" : "";
  const m = n.match(/「([^」]+)」/);
  if (m) return m[1] + old;
  const maker = (p.maker ?? "").replace(/^製造販売元／/, "").trim();
  return `${cardName(n).base}${maker ? `（${maker}）` : "（先発）"}${old}`;
}

/**
 * 見分け注意の組の札の色と形（A・B… の組ごとに違う。色の見分けにくい人にも形で分かるように）。
 * 色は色覚の違いに配慮した Okabe-Ito の色。文字の色は背景に合わせて白か黒
 */
const GROUP_STYLES: { fill: string; text: string; shape: "circle" | "square" | "diamond" | "triangle" }[] = [
  { fill: "#E69F00", text: "#000000", shape: "circle" },
  { fill: "#0072B2", text: "#FFFFFF", shape: "square" },
  { fill: "#009E73", text: "#FFFFFF", shape: "diamond" },
  { fill: "#CC79A7", text: "#000000", shape: "triangle" },
  { fill: "#D55E00", text: "#FFFFFF", shape: "square" },
  { fill: "#56B4E9", text: "#000000", shape: "diamond" },
  { fill: "#F0E442", text: "#000000", shape: "triangle" },
  { fill: "#000000", text: "#FFFFFF", shape: "circle" },
];

export function groupStyle(label: string) {
  const i = /^[A-Z]$/.test(label) ? label.charCodeAt(0) - 65 : Number(label) - 1 || 0;
  return GROUP_STYLES[((i % GROUP_STYLES.length) + GROUP_STYLES.length) % GROUP_STYLES.length];
}
