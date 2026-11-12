/**
 * 画面に出す短い文字（刻印・製品の呼び名・図の名前）。薬剤師が 1 日に何度も見るので、見分けに役立つものだけを短く出す。
 * React に依存しない純粋な関数（照合・安全の判断には使わない。表示だけ）
 */

type Named = { brand_name: string; generic_name?: string | null; maker?: string | null };
type WithImprint = Named & { imprint_front: string; imprint_back: string };

/** かな・漢字（成分名・販売名として比べるのは、かな・漢字を含む部分だけ） */
const JA = /[ぁ-ゖァ-ヺ一-鿿々]/;

export type ImprintKind = "name" | "code" | "none" | "unverified";

function nfkc(s: string | null | undefined): string {
  return (s ?? "").normalize("NFKC").replace(/[\s　]/g, "");
}

const SALT_ANY = /(塩酸|臭化水素酸|硫酸|リン酸|酢酸|コハク酸|クエン酸|フマル酸|マレイン酸|酒石酸|メシル酸|ベシル酸|トシル酸|乳酸|硝酸)塩/g;

/** この製品自身の名前の材料：規格の数字、販売名の「」のメーカー、成分名・販売名（頭 3 文字以上で比べる） */
function ownParts(p: Named) {
  const brand = p.brand_name.normalize("NFKC");
  const nums = new Set(brand.match(/\d+(?:\.\d+)?/g) ?? []);
  for (const x of (p as { strength?: string | null }).strength?.normalize("NFKC").match(/\d+(?:\.\d+)?/g) ?? []) nums.add(x);
  const maker = (brand.match(/「([^」]+)」/) ?? [])[1]?.replace(/\s/g, "").toUpperCase() ?? null;
  const plain = brand.replace(/「[^」]*」/g, "").replace(/\([^)]*\)/g, "");
  const pre = (plain.match(/^(.*?)(錠|カプセル|ゼリー)/) ?? [])[1] ?? plain;
  const base = cardName(brand).base;
  const names = [...new Set([base, base.replace(SALT_ANY, ""), pre, pre.replace(SALT_ANY, ""), plain, p.generic_name?.normalize("NFKC") ?? ""])]
    .map((x) => x.replace(/\s/g, "").toUpperCase())
    .filter(Boolean);
  // 販売名の中の英字（OD・Na・LD・HD・BP・D など）と剤形の語（配合錠・配合・錠）も自身の名前の部品（ただしこれだけでは名前印字にしない）
  const latin = [...new Set((plain.replace(/\d+(?:\.\d+)?(mg|μg|g)/gi, " ").match(/[A-Za-z]+/g) ?? []).map((x) => x.toUpperCase()))];
  const forms = ["配合錠", "配合", "OD錠", "錠", "徐放", "腸溶", "口腔内崩壊"].filter((f) => plain.includes(f));
  return { nums, maker, names, parts: [...latin, ...forms].sort((a, b) => b.length - a.length) };
}

/**
 * 刻印の 1 語（空白で区切ったもの）が、この製品自身の名前か。語の頭から、規格の数字・自社の「」のメーカー名・
 * 成分名・販売名の頭 3 文字以上（短い名前は全部）をつないで、語の全部を説明できれば自身の名前（例：「10KMP」＝規格＋自社）。
 * 他社のメーカー名・頭 2 文字だけ同じ語・規格と違う数字は自身の名前ではない
 */
function isOwnToken(token: string, own: ReturnType<typeof ownParts>): { own: boolean; hasName: boolean } {
  const t = token.normalize("NFKC").toUpperCase();
  if (/^[\/・\-－ー.,、。:：]+$/.test(t)) return { own: true, hasName: false }; // 区切りの記号だけの語（「ゾルピデム 10 / ゾルピデム 10KMP」の「/」）
  // reach[i]：頭から i 文字までを説明できる。named[i]：成分名・販売名を 1 つ以上使って説明できる（数字・メーカー名だけでない）
  const reach = Array(t.length + 1).fill(false);
  const named = Array(t.length + 1).fill(false);
  reach[0] = true;
  for (let i = 0; i < t.length; i++) {
    if (!reach[i]) continue;
    const rest = t.slice(i);
    const steps: [number, boolean][] = []; // [長さ, 名前か]
    const n = rest.match(/^\d+(?:\.\d+)?/);
    if (n && own.nums.has(n[0])) {
      steps.push([n[0].length, false]);
      const u = rest.slice(n[0].length).match(/^(MG|ΜG|G|番|号)/); // 規格の単位（250mg・3番）
      if (u) steps.push([n[0].length + u[0].length, false]);
    }
    for (const part of own.parts) if (rest.startsWith(part)) steps.push([part.length, false]);
    if (own.maker && rest.startsWith(own.maker)) steps.push([own.maker.length, false]);
    for (const name of own.names) {
      let l = 0;
      while (l < rest.length && l < name.length && rest[l] === name[l]) l++;
      for (let k = l; k >= Math.min(3, name.length) && k > 0; k--) if (JA.test(rest.slice(0, k))) steps.push([k, true]);
      // 名前の後ろ半分（行で分けた「カンデ8 サルタン」の「サルタン」）：名前の末尾 3 文字以上と同じ
      if (i === 0) for (let k = Math.min(rest.length, name.length - 1); k >= 3; k--) if (JA.test(rest.slice(0, k)) && name.endsWith(rest.slice(0, k))) steps.push([k, true]);
    }
    for (const [len, isName] of steps) {
      reach[i + len] = true;
      if (isName || named[i]) named[i + len] = true;
    }
  }
  return { own: reach[t.length], hasName: named[t.length] };
}

/** 刻印を空白で語に分け（空白を消す前に分ける）、1 語ずつ自身の名前かを付ける */
export function imprintTokens(imprint: string | null | undefined, p: Named): { text: string; own: boolean }[] {
  const own = ownParts(p);
  const words = (imprint ?? "").trim().split(/[\s　]+/).filter(Boolean);
  const marked = words.map((w) => ({ text: w, ...isOwnToken(w, own) })); // 出す文字は元のまま（「2½」を崩さない）
  // 成分名・販売名の語が 1 つも無い（規格の数字・自社のメーカー名だけ。「JG C31」「YD 550」「5」）なら、全部を記号として出す
  const hasName = marked.some((m) => m.own && m.hasName);
  return marked.map((m) => ({ text: m.text, own: m.own && hasName }));
}

/**
 * 刻印の種類。
 *  name：語のすべてがこの製品自身の名前（成分名・販売名の頭 3 文字以上・規格の数字・自社の「」のメーカー名）。文字を出さず「名前印字」
 *  code：自身の名前でない語（記号・番号・他社名・別の成分・規格と違う数字）が 1 つでもある。その語は出す
 *  none：「なし」　unverified：「未確認」・空
 */
export function imprintKind(imprint: string | null | undefined, p: Named): ImprintKind {
  const s = (imprint ?? "").trim();
  if (!s || s === "未確認") return "unverified";
  if (s === "なし") return "none";
  return imprintTokens(s, p).every((t) => t.own) ? "name" : "code";
}

/** 記号の面に出す文字：自身の名前の語を落とし、残りの語を出す。落とした語があれば「（名前印字）」を添える（例：「SW（名前印字）」） */
function codeText(imprint: string, p: Named): string {
  const toks = imprintTokens(imprint, p);
  const rest = toks.filter((t) => !t.own).map((t) => t.text).join(" ");
  return toks.some((t) => t.own) ? `${rest}（名前印字）` : rest;
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
  if (bk === "code" && !same) back = codeText(p.imprint_back, p);
  else if (bk === "none" && fk === "code") back = "なし";
  return { front: fk === "code" ? codeText(p.imprint_front, p) : null, nameTag: fk === "name", frontUnverified: fk === "unverified", back };
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
