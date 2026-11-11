// scripts/eval/score-rx.cjs（読み取りの自動採点）を、わざと崩した読み取り結果で試す。
//   node --test tests/rx/
// 【直った不具合】＝品質が見つけて a518848 で直ったもの（戻らないことを見る）。【不具合】の付いたテストは todo（今は失敗する。直したら todo を外す）
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { ROOT, expectedOf, parseCsv } = require("./helpers.cjs");

const SCORER = path.join(ROOT, "scripts/eval/score-rx.cjs");
const { normalize, coreName, judgeRow, align } = require(SCORER);

const clone = (o) => JSON.parse(JSON.stringify(o));
const exp = (id) => clone(expectedOf(id));
const idx = (items, rp) => items.findIndex((x) => x.rp === rp);

/**
 * 結果のファイルを置いて採点を走らせる。files：{ "rx07__QA__t__x.json": オブジェクト または 文字列 }
 * 返り値：status、all（groups.csv の all 行）、rows（rows.csv の行）、stderr
 */
function score(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "score-rx-"));
  const res = path.join(dir, "results");
  fs.mkdirSync(res);
  for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(res, f), typeof c === "string" ? c : JSON.stringify(c));
  const out = path.join(dir, "out/score");
  const r = spawnSync(process.execPath, [SCORER, "--results", res, "--out", out], { encoding: "utf8" });
  const read = (suffix) => {
    const f = `${out}${suffix}`;
    if (!fs.existsSync(f)) return [];
    const [head, ...rest] = parseCsv(fs.readFileSync(f, "utf8")).filter((x) => x.length > 1);
    return rest.map((x) => Object.fromEntries(head.map((h, i) => [h, x[i]])));
  };
  const groups = read("-groups.csv");
  const rows = read("-rows.csv");
  fs.rmSync(dir, { recursive: true, force: true });
  const all = groups.find((g) => g.group === "all");
  return { status: r.status, stderr: r.stderr, stdout: r.stdout, all, rows };
}
const acc = (all, f) => Number(all[`${f}_acc`]);
const rowOf = (rows, rp) => rows.find((r) => r.rp === rp);

// ---------- 基準 ----------
test("正解そのもの 20 件：145/145 行が全部正しい、抜け・余分 0", () => {
  const files = {};
  for (let i = 1; i <= 20; i++) {
    const id = `rx${String(i).padStart(2, "0")}`;
    files[`${id}__QA__copy__clean.json`] = { result: exp(id), usage: { input: 1, output: 1 } };
  }
  const { status, all } = score(files);
  assert.equal(status, 0);
  assert.equal(Number(all.rows), 145);
  assert.equal(Number(all.missing), 0);
  assert.equal(Number(all.extra), 0);
  assert.equal(Number(all.images_perfect), 20);
  for (const f of ["name", "name_core", "strength", "per_timing", "days", "total", "pack", "mark", "name_note", "row_ok"]) assert.equal(acc(all, f), 1, f);
});

// ---------- 行の対応づけ ----------
test("行の順番を逆にし Rp も振り直しても、全部正しい（順番に頼らない）", () => {
  const e = exp("rx07");
  e.items.reverse().forEach((it, i) => (it.rp = String(i + 1).padStart(2, "0")));
  const { all } = score({ "rx07__QA__rev__x.json": e });
  assert.equal(Number(all.missing), 0);
  assert.equal(Number(all.extra), 0);
  assert.equal(acc(all, "row_ok"), 1);
});

test("同じ薬の別規格：順番を入れ替え Rp も入れ替えても、規格で対応づける（最初に当たった名前ではない）", () => {
  const e = exp("rx04"); // Rp04 ワーファリン錠1mg 0-0-3、Rp05 ワーファリン錠0.5mg 0-0-1
  const a = idx(e.items, "04"), b = idx(e.items, "05");
  [e.items[a], e.items[b]] = [e.items[b], e.items[a]];
  e.items[a].rp = "04";
  e.items[b].rp = "05";
  const { all, rows } = score({ "rx04__QA__swap__x.json": e });
  assert.equal(acc(all, "row_ok"), 1);
  assert.equal(rowOf(rows, "04").pred_name, "ワーファリン錠1mg");
  assert.equal(rowOf(rows, "05").pred_name, "ワーファリン錠0.5mg");
});

test("同じ薬の別規格：1mg の行が抜けて Rp が詰まっても、0.5mg は 0.5mg に対応し、抜けは 1mg（Rp04）", () => {
  const e = exp("rx04");
  e.items.splice(idx(e.items, "04"), 1);
  e.items.forEach((it, i) => (it.rp = String(i + 1).padStart(2, "0")));
  const { all, rows } = score({ "rx04__QA__drop__x.json": e });
  assert.equal(Number(all.missing), 1);
  assert.equal(Number(all.extra), 0);
  assert.equal(rowOf(rows, "04").pred_name, "（抜け）");
  assert.equal(rowOf(rows, "05").pred_name, "ワーファリン錠0.5mg");
  assert.equal(rowOf(rows, "05").row_ok, "1");
});

test("同じ薬の別規格で規格を取り違えた（10mg と 2.5mg の数を入れ替え）→ 2 行とも誤り", () => {
  const e = exp("rx07"); // Rp05 カルベジロール錠10mg「トーワ」朝、Rp06 2.5mg「サワイ」夕
  const a = e.items[idx(e.items, "05")], b = e.items[idx(e.items, "06")];
  [a.per_timing, b.per_timing] = [b.per_timing, a.per_timing];
  const { rows } = score({ "rx07__QA__x__x.json": e });
  assert.equal(rowOf(rows, "05").row_ok, "0");
  assert.equal(rowOf(rows, "06").row_ok, "0");
});

// ---------- 薬品名 ----------
test("OD とふつうの錠の取り違えは薬品名の誤り（基幹名でも誤り）。行は対応づけられ、抜けにはならない", () => {
  const e = exp("rx06"); // Rp03 アムロジピンOD錠10mg「武田テバ」
  e.items[idx(e.items, "03")].name_as_written = "アムロジピン錠10mg「武田テバ」";
  const { all, rows } = score({ "rx06__QA__od__x.json": e });
  const r = rowOf(rows, "03");
  assert.equal(r.pred_name, "アムロジピン錠10mg「武田テバ」");
  assert.equal(r.name, "0");
  assert.equal(r.name_core, "0");
  assert.equal(r.row_ok, "0");
  assert.equal(Number(all.missing), 0);
});

test("CR と L の取り違えは薬品名の誤り", () => {
  const e = exp("rx06"); // Rp01 ニフェジピンCR錠20mg「サワイ」
  e.items[idx(e.items, "01")].name_as_written = "ニフェジピンL錠20mg「サワイ」";
  const { rows } = score({ "rx06__QA__cr__x.json": e });
  assert.equal(rowOf(rows, "01").name, "0");
  assert.equal(rowOf(rows, "01").row_ok, "0");
});

test("メーカー名の誤り（「サワイ」→「トーワ」）は薬品名の誤りに数える。基幹名は正しい", () => {
  // 正規化は括弧 ( ) （ ） の中だけを除き、「」は残す。だからメーカーの誤りは「薬品名」と「行が全部正しい」に効く
  assert.notEqual(normalize("カルベジロール錠2.5mg「トーワ」"), normalize("カルベジロール錠2.5mg「サワイ」"));
  const e = exp("rx02"); // Rp03 カルベジロール錠2.5mg「サワイ」、Rp04 カルベジロール錠10mg「トーワ」
  e.items[idx(e.items, "03")].name_as_written = "カルベジロール錠2.5mg「トーワ」";
  e.items[idx(e.items, "04")].name_as_written = "カルベジロール錠10mg「サワイ」";
  const { rows } = score({ "rx02__QA__maker__x.json": e });
  for (const rp of ["03", "04"]) {
    const r = rowOf(rows, rp);
    assert.equal(r.name, "0", rp);
    assert.equal(r.name_core, "1", rp);
    assert.equal(r.strength, "1", rp);
    assert.equal(r.row_ok, "0", rp);
  }
});

test("メーカー名を落とした（「サワイ」なし）→ 薬品名は誤り", () => {
  const e = exp("rx01");
  e.items[0].name_as_written = "アムロジピン錠5mg";
  const { rows } = score({ "rx01__QA__x__x.json": e });
  assert.equal(rowOf(rows, "01").name, "0");
  assert.equal(rowOf(rows, "01").name_core, "1");
});

test("メーカー名を（ ）で書いた（「サワイ」→（トーワ））→ 括弧ごと消えるが、「」が無いので薬品名は誤り", () => {
  const e = exp("rx01");
  e.items[0].name_as_written = "アムロジピン錠5mg（トーワ）";
  const { rows } = score({ "rx01__QA__x__x.json": e });
  assert.equal(rowOf(rows, "01").name, "0");
});

test("(K) の接頭辞：落としても薬品名は正しい扱い（決まりどおり。docs に書いてある）", () => {
  const e = exp("rx03"); // Rp01 (K)アスパラカリウム錠300mg
  e.items[0].name_as_written = "アスパラカリウム錠300mg";
  const { rows } = score({ "rx03__QA__x__x.json": e });
  assert.equal(rowOf(rows, "01").name, "1");
  assert.equal(rowOf(rows, "01").row_ok, "1");
});

test("【般】を落とすと薬品名は誤り、基幹名は正しい", () => {
  const e = exp("rx05");
  e.items[0].name_as_written = "アムロジピン錠5mg";
  const { rows } = score({ "rx05__QA__x__x.json": e });
  assert.equal(rowOf(rows, "01").name, "0");
  assert.equal(rowOf(rows, "01").name_core, "1");
});

test("【直った不具合】( ) の中の取り違えが見えない：「アムロジピン(OD)錠2.5mg「サワイ」」をふつうの錠の正解に対して正しいと数える", () => {
  const e = exp("rx06"); // Rp04 アムロジピン錠2.5mg「サワイ」（ふつうの錠）
  e.items[idx(e.items, "04")].name_as_written = "アムロジピン(OD)錠2.5mg「サワイ」";
  const { rows } = score({ "rx06__QA__x__x.json": e });
  assert.equal(rowOf(rows, "04").name, "0");
});

test("【直った不具合】括弧の補足に入った別の品名が見えない：「ワーファリン錠1mg（0.5mg）」を 1mg の正解に対して正しいと数える", () => {
  const e = exp("rx18");
  e.items[0].name_as_written = "ワーファリン錠1mg（0.5mg）";
  const { rows } = score({ "rx18__QA__x__x.json": e });
  assert.equal(rowOf(rows, "01").name, "0");
});

test("【直った不具合】接頭辞の取り違え (K)→(Na) を正しいと数える（狙い「接頭辞」の項目が薬品名なのに、接頭辞は比べていない）", () => {
  const e = exp("rx03");
  e.items[0].name_as_written = "(Na)アスパラカリウム錠300mg";
  const { rows } = score({ "rx03__QA__x__x.json": e });
  assert.equal(rowOf(rows, "01").name, "0");
});

test("【直った不具合】【般】ニフェジピン徐放錠の 12時間／24時間 の取り違え（CR と L の別）が「行が全部正しい」に効かない", () => {
  const e = exp("rx15"); // Rp03 【般】ニフェジピン徐放錠10mg（12時間持続）→ L 錠
  const it = e.items[idx(e.items, "03")];
  it.name_as_written = "【般】ニフェジピン徐放錠10mg（24時間持続）";
  it.name_note = null;
  const { rows } = score({ "rx15__QA__x__x.json": e });
  const r = rowOf(rows, "03");
  assert.equal(r.name_note, "0"); // 補足の項目は誤りにしている
  assert.equal(r.row_ok, "0"); // ← ここが 1 になる
});

// ---------- 規格 ----------
test("規格：配合錠は印字の記号（AKI 11/11）。ユニシア配合錠HD：HD・hd・ＨＤ は正しい、null・LD・10mg は誤り", () => {
  const e = exp("rx16").items[0]; // ユニシア配合錠HD
  assert.equal(e.strength, "HD");
  for (const ok of ["HD", "hd", "ＨＤ", " HD "]) assert.equal(judgeRow(e, { ...e, strength: ok }, 14).strength, true, ok);
  for (const ng of [null, "", "LD", "10mg", "HD錠", "配合錠HD"]) assert.equal(judgeRow(e, { ...e, strength: ng }, 14).strength, false, String(ng));
});

test("規格：バファリン配合錠A81 は A81。81mg・81 は誤り。記号の無いノイロビタンは null・空だけ正しい", () => {
  const items = exp("rx16").items;
  const baf = items.find((x) => x.name_as_written === "バファリン配合錠A81");
  assert.equal(baf.strength, "A81");
  assert.equal(judgeRow(baf, { ...baf, strength: "a81" }, 14).strength, true);
  for (const ng of ["81mg", "81", "A", null]) assert.equal(judgeRow(baf, { ...baf, strength: ng }, 14).strength, false, String(ng));
  const neu = items.find((x) => x.name_as_written === "ノイロビタン配合錠");
  assert.equal(neu.strength, null);
  for (const ok of [null, "", "　"]) assert.equal(judgeRow(neu, { ...neu, strength: ok }, 42).strength, true, JSON.stringify(ok));
  for (const ng of ["錠", "配合", "配合錠", "25mg"]) assert.equal(judgeRow(neu, { ...neu, strength: ng }, 42).strength, false, ng);
});

test("【直った不具合】規格：配合錠で「錠」「配合」のような名前の一部を規格として読んでも正しい扱い", () => {
  const e = exp("rx16").items[0];
  assert.equal(judgeRow(e, { ...e, strength: "錠" }, 14).strength, false);
  assert.equal(judgeRow(e, { ...e, strength: "配合" }, 14).strength, false);
});

// ---------- 数・印 ----------
test("□コ・別包・朝昼夕・日数の誤りはそれぞれ数え、□コ の取りこぼし／付けすぎも数える", () => {
  const e = exp("rx14"); // Rp01 □コ＋別包＋2-0-1
  const r1 = e.items[0];
  r1.manual_fill_mark = false;
  r1.pack_instruction = "none";
  r1.per_timing = { morning: 1, noon: 0, evening: 2 };
  e.items[3].manual_fill_mark = true; // ジゴシン（印なし）に付けすぎ
  e.items[4].days = 28;
  const { rows, all } = score({ "rx14__QA__x__x.json": e });
  const r = rowOf(rows, "01");
  assert.deepEqual([r.mark, r.pack, r.per_timing, r.row_ok], ["0", "0", "0", "0"]);
  assert.equal(rowOf(rows, "04").mark, "0");
  assert.equal(rowOf(rows, "05").days, "0");
  assert.equal(rowOf(rows, "05").total, "0");
  assert.equal(Number(all.rows), 7);
  assert.equal(acc(all, "row_ok").toFixed(4), (4 / 7).toFixed(4));
});

test("null の項目：per_timing・日数・規格・□コ が null でも落ちず、その項目は誤り", () => {
  const e = exp("rx01");
  Object.assign(e.items[0], { per_timing: null, days: null, strength: null, manual_fill_mark: null, dose_per_day: null, pack_instruction: null, name_note: null });
  const { status, rows } = score({ "rx01__QA__x__x.json": e });
  assert.equal(status, 0);
  const r = rowOf(rows, "01");
  assert.deepEqual([r.per_timing, r.days, r.strength, r.mark, r.dose_per_day, r.total, r.pack, r.row_ok], ["0", "0", "0", "0", "0", "0", "0", "0"]);
  assert.equal(r.name, "1");
});

test("薬品名が null の行は対応させず、正解行は抜け・読み取り行は余分", () => {
  const e = exp("rx01");
  e.items[0].name_as_written = null;
  const { status, all, rows } = score({ "rx01__QA__x__x.json": e });
  assert.equal(status, 0);
  assert.equal(rowOf(rows, "01").pred_name, "（抜け）");
  assert.equal(Number(all.missing), 1);
  assert.equal(Number(all.extra), 1);
});

test("数を文字列で返しても数として比べる（\"2\" は 2）", () => {
  const e = exp("rx02").items[0];
  assert.equal(judgeRow(e, { ...e, days: "14", per_timing: { morning: "2", noon: "0", evening: "2" } }, 56).row_ok, true);
});

test("【直った不具合】true を 1 錠と数える（数でない値は誤りにすべき）", () => {
  const e = exp("rx01").items[0]; // 朝 1
  assert.equal(judgeRow(e, { ...e, per_timing: { morning: true, noon: 0, evening: 0 } }, 28).morning, false);
});

test("【直った不具合】就寝前だけの薬：1日量を 0 と読んでも（就寝前を落としても）「行が全部正しい」", () => {
  const e = exp("rx09"); // Rp06 センノシド錠12mg 1回2錠 就寝前
  Object.assign(e.items[idx(e.items, "06")], { dose_per_time: null, times_per_day: 0, dose_per_day: 0, raw_usage_text: "" });
  const { rows } = score({ "rx09__QA__x__x.json": e });
  assert.equal(rowOf(rows, "06").dose_per_day, "0");
  assert.equal(rowOf(rows, "06").row_ok, "0");
});

// ---------- 抜け・余分 ----------
test("余分な行（読み取りがでっち上げた行・同じ行の重複）を数える", () => {
  const e = exp("rx01");
  e.items.push({ ...clone(e.items[0]), rp: "07", name_as_written: "ガスター錠20mg", strength: "20mg" });
  e.items.push(clone(e.items[1]));
  const { all } = score({ "rx01__QA__x__x.json": e });
  assert.equal(Number(all.extra), 2);
  assert.equal(Number(all.missing), 0);
  assert.equal(acc(all, "row_ok"), 1);
  assert.equal(Number(all.images_perfect), 0);
});

test("行を 2 つ抜くと抜け 2、分母は正解の行数のまま", () => {
  const e = exp("rx20");
  e.items.splice(3, 2);
  const { all } = score({ "rx20__QA__x__x.json": e });
  assert.equal(Number(all.rows), 11);
  assert.equal(Number(all.missing), 2);
  assert.equal(acc(all, "row_ok").toFixed(4), (9 / 11).toFixed(4));
});

test("空の結果（items が空）→ 全部抜け。読み取り失敗には数えない", () => {
  const e = exp("rx01");
  e.items = [];
  const { status, all } = score({ "rx01__QA__x__x.json": e });
  assert.equal(status, 0);
  assert.equal(Number(all.missing), 6);
  assert.equal(Number(all.failed), 0);
  assert.equal(acc(all, "row_ok"), 0);
});

test("{error} だけ・{} ・null・items が null は「読み取り失敗」、全部抜け", () => {
  const { status, all } = score({
    "rx01__QA__a__x.json": { error: "失敗" },
    "rx02__QA__b__x.json": {},
    "rx03__QA__c__x.json": "null",
    "rx04__QA__d__x.json": { result: { items: null } },
  });
  assert.equal(status, 0);
  assert.equal(Number(all.images), 4);
  assert.equal(Number(all.failed), 4);
  assert.equal(Number(all.missing), 6 + 7 + 7 + 7);
});

test("一包化の指示：rx11（All One Dose なし）を true と読めば誤り", () => {
  const e = exp("rx11");
  e.all_one_dose = true;
  const { all } = score({ "rx11__QA__x__x.json": e });
  assert.equal(Number(all.all_one_dose_acc), 0);
  assert.equal(Number(all.images_perfect), 0);
  assert.equal(acc(all, "row_ok"), 1);
});

test("正解の無い処方名のファイルは採点しない（rx99）", () => {
  const { status, all, stdout } = score({ "rx99__QA__x__x.json": exp("rx01"), "rx01__QA__x__x.json": exp("rx01") });
  assert.equal(status, 0);
  assert.equal(Number(all.images), 1, stdout);
});

test("結果のフォルダが空なら終了コード 1", () => {
  const { status } = score({});
  assert.equal(status, 1);
});

test("【直った不具合】壊れた JSON が 1 つあると採点全体が落ちる（読み取り失敗として数え、ほかは採点すべき）", () => {
  const { status, all, stderr } = score({ "rx01__QA__x__x.json": "{\"items\": [", "rx02__QA__x__x.json": exp("rx02") });
  assert.equal(status, 0, stderr.slice(0, 300));
  assert.equal(Number(all.images), 2);
  assert.equal(Number(all.failed), 1);
});

test("【直った不具合】空のファイル（0 バイト）で採点全体が落ちる", () => {
  const { status } = score({ "rx01__QA__x__x.json": "", "rx02__QA__x__x.json": exp("rx02") });
  assert.equal(status, 0);
});

test("【直った不具合】items の中に null の行があると採点全体が落ちる", () => {
  const e = exp("rx01");
  e.items.splice(2, 0, null);
  const { status, all } = score({ "rx01__QA__x__x.json": e });
  assert.equal(status, 0);
  assert.equal(Number(all.missing), 0);
});

test("【直った不具合】ページごとに保存した結果（rx05-1__…、rx05-2__…）を、どちらも処方全体（10 行）と比べて抜けを二重に数える", () => {
  const e = exp("rx05");
  const p1 = { ...e, items: e.items.slice(0, 6) };
  const p2 = { ...e, items: e.items.slice(6) };
  const { all } = score({ "rx05-1__QA__x__x.json": p1, "rx05-2__QA__x__x.json": p2 });
  assert.equal(Number(all.missing), 0);
});

// ---------- 関数の単体 ----------
test("normalize：全角・空白・μ・括弧内の補足をそろえる。「」と【般】は残す", () => {
  assert.equal(normalize("アムロジピン錠５ｍｇ　「サワイ」"), normalize("アムロジピン錠5mg「サワイ」"));
  assert.equal(normalize("メチコバール錠500µg"), normalize("メチコバール錠500μg"));
  assert.ok(normalize("【般】アムロジピン錠5mg").startsWith("【般】"));
  assert.equal(coreName("【般】カルベジロール錠2.5mg"), coreName("カルベジロール錠2.5mg「サワイ」"));
  assert.equal(coreName("(K)アスパラカリウム錠300mg"), coreName("アスパラカリウム錠300mg"));
});

test("align：17 行以上は貪欲法に切り替わるが、正解そのものなら全部対応する", () => {
  const items = Array.from({ length: 18 }, (_, i) => ({ rp: String(i + 1), name_as_written: `テスト薬${String.fromCharCode(0x30a2 + i * 2)}錠${i + 1}mg`, strength: `${i + 1}mg`, per_timing: { morning: 1, noon: 0, evening: 0 } }));
  const m = align(items, clone(items).reverse());
  assert.deepEqual(m, items.map((_, i) => 17 - i));
});

test("採点側の正規化の写しが lib/master.ts と同じ（checkDrift が null）", () => {
  assert.equal(require(SCORER).checkDrift(), null);
});

// ---------- 再検査（a518848 の直しに、前回と違う入力を当てる） ----------
const one = (id, mutate) => {
  const e = exp(id);
  mutate(e);
  return score({ [`${id}__QA__re__x.json`]: e });
};

test("再：括弧の中で薬が変わる別の書き方（(L)・（CR）・全角括弧・後ろの括弧）はすべて薬品名の誤り", () => {
  const cases = [
    ["rx06", "01", "ニフェジピン(L)錠20mg「サワイ」"], // 正解 CR
    ["rx06", "01", "ニフェジピンCR錠20mg「サワイ」（L）"],
    ["rx06", "04", "アムロジピン錠2.5mg「サワイ」（ＯＤ）"],
    ["rx18", "02", "ワーファリン錠0.5mg（1mg）"],
  ];
  for (const [id, rp, name] of cases) {
    const { rows } = one(id, (e) => (e.items[idx(e.items, rp)].name_as_written = name));
    assert.equal(rowOf(rows, rp).name, "0", name);
    assert.equal(rowOf(rows, rp).row_ok, "0", name);
  }
});

test("再：全角・半角・空白の違いだけなら正しい（厳しくしすぎていない）", () => {
  const { rows } = one("rx06", (e) => {
    e.items[idx(e.items, "01")].name_as_written = "ニフェジピンＣＲ錠２０ｍｇ　「サワイ」";
    e.items[idx(e.items, "03")].name_as_written = "アムロジピンOD錠10mg 「武田テバ」";
  });
  assert.equal(rowOf(rows, "01").row_ok, "1");
  assert.equal(rowOf(rows, "03").row_ok, "1");
});

test("再：接頭辞 — (Ca)→(K)、正解に無い接頭辞を足す、全角（Ｋ）は同じ扱い", () => {
  let r = one("rx03", (e) => (e.items[idx(e.items, "03")].name_as_written = "(K)アスパラ-CA錠200mg")).rows; // 正解 (Ca)
  assert.equal(rowOf(r, "03").name, "0");
  r = one("rx19", (e) => (e.items[idx(e.items, "05")].name_as_written = "(K)グルコンサンK錠5mEq")).rows; // 正解に接頭辞なし
  assert.equal(rowOf(r, "05").name, "0");
  r = one("rx03", (e) => (e.items[0].name_as_written = "（Ｋ）アスパラカリウム錠300mg")).rows;
  assert.equal(rowOf(r, "01").name, "1");
  r = one("rx03", (e) => (e.items[0].name_as_written = "(k)アスパラカリウム錠300mg")).rows;
  assert.equal(rowOf(r, "01").name, "1");
});

test("再：補足 — 補足を名前の括弧に入れたら薬品名の誤り、name_note の 12/24 の取り違えは行の誤り、空白違いは正しい", () => {
  let r = one("rx15", (e) => {
    const it = e.items[idx(e.items, "02")]; // 【般】ニフェジピン徐放錠20mg（24時間持続）
    it.name_note = "12時間持続";
  }).rows;
  assert.equal(rowOf(r, "02").name, "1");
  assert.equal(rowOf(r, "02").name_note, "0");
  assert.equal(rowOf(r, "02").row_ok, "0");
  r = one("rx15", (e) => (e.items[idx(e.items, "02")].name_note = "24 時間持続")).rows;
  assert.equal(rowOf(r, "02").row_ok, "1");
  r = one("rx10", (e) => {
    const it = e.items[0]; // ダーブロック錠4mg（通院HD患者は院内処方）
    it.name_as_written = "ダーブロック錠4mg（通院HD患者は院内処方）";
  }).rows;
  assert.equal(rowOf(r, "01").name, "0");
  // 補足が無い行に補足を足すのも誤り
  r = one("rx01", (e) => (e.items[0].name_note = "粉砕不可")).rows;
  assert.equal(rowOf(r, "01").row_ok, "0");
});

test("再：数 — \"2.0\"・\" 2 \"・\"２\" は 2、\"2錠\"・NaN・Infinity・[2]・{}・false は誤り。正解 null の 1回量に 0 は誤り", () => {
  const e = exp("rx02").items[0]; // 朝 2、日数 14
  for (const ok of [2, "2.0", " 2 ", "２"]) assert.equal(judgeRow(e, { ...e, per_timing: { ...e.per_timing, morning: ok } }, 56).morning, true, JSON.stringify(ok));
  for (const ng of ["2錠", NaN, Infinity, [2], {}, false, null, ""]) assert.equal(judgeRow(e, { ...e, per_timing: { ...e.per_timing, morning: ng } }, 56).morning, false, String(ng));
  const p = exp("rx04").items[0]; // 1-0-2-0-0-0：1回量 null
  assert.equal(p.dose_per_time, null);
  assert.equal(judgeRow(p, { ...p, dose_per_time: 0 }, 84).dose_per_time, false);
  assert.equal(judgeRow(p, { ...p, dose_per_time: "" }, 84).dose_per_time, true);
  assert.equal(judgeRow(p, { ...p, dose_per_time: 1 }, 84).dose_per_time, false);
});

test("再：眠前 — rx17 の 1-0-1-1 で眠前を落とす（1日量 2）・眠前を夕に寄せる（1-0-2）は行の誤り、正しく 3 なら正しい", () => {
  let r = one("rx17", (e) => (e.items[idx(e.items, "05")].dose_per_day = 2)).rows;
  assert.equal(rowOf(r, "05").bedtime, "0");
  assert.equal(rowOf(r, "05").row_ok, "0");
  r = one("rx17", (e) => (e.items[idx(e.items, "05")].per_timing = { morning: 1, noon: 0, evening: 2 })).rows;
  assert.equal(rowOf(r, "05").row_ok, "0");
  r = one("rx17", () => {}).rows;
  assert.equal(rowOf(r, "05").row_ok, "1");
  assert.equal(rowOf(r, "05").bedtime, "1");
  // 眠前の無い薬に眠前を足す（朝 1 なのに 1日量 2）も誤り
  r = one("rx01", (e) => (e.items[0].dose_per_day = 2)).rows;
  assert.equal(rowOf(r, "01").row_ok, "0");
});

test("再：壊れた入力 — 一番上が配列、items に文字列・数・配列、BOM 付きの JSON、usage が文字列 でも止まらない", () => {
  const good = exp("rx08");
  const mixed = exp("rx02");
  mixed.items.splice(1, 0, "x", 3, [], true);
  const { status, all, stderr } = score({
    "rx01__QA__a__x.json": "[]",
    "rx02__QA__b__x.json": mixed,
    "rx03__QA__c__x.json": "\uFEFF" + JSON.stringify(exp("rx03")),
    "rx04__QA__d__x.json": { result: exp("rx04"), usage: "lots" },
    "rx05__QA__e__x.json": "{\"result\": {\"items\": [}}",
    "rx06__QA__f__x.json": { result: { items: "abc" } },
    "rx07__QA__g__x.json": { items: [{}] },
    "rx08__QA__h__x.json": good,
  });
  assert.equal(status, 0, stderr.slice(0, 300));
  assert.equal(Number(all.images), 8);
  // 失敗：[]、壊れた JSON、items が文字列（BOM 付きは下の todo）
  const failed = Number(all.failed);
  assert.equal(failed, 3, `failed=${failed}`); // []、壊れた JSON、items が文字列。BOM 付きは直った（ae8b604）
  // 混ざったゴミの行は捨てて採点（rx02）、BOM 付き（rx03）、usage が文字列（rx04）、正しいもの（rx08）：4 つとも全部正しい
  assert.equal(Number(all.images_perfect), 4); // BOM 付き（rx03）も直ったので 4
  assert.equal(Number(all.extra), 1); // rx07 の {} の行（名前なし）だけが余分
});

test("【不具合】BOM 付きの JSON（メモ帳などで保存）を「読み取り失敗」に数える", () => {
  const { all } = score({ "rx03__QA__c__x.json": "\uFEFF" + JSON.stringify(exp("rx03")) });
  assert.equal(Number(all.failed), 0);
  assert.equal(acc(all, "row_ok"), 1);
});

test("再：ページごと — 片方のページが壊れていれば読み取り失敗に数え、読めたページの行は採点する。ページが逆順の名前でも同じ", () => {
  const e = exp("rx10"); // 5 行 + 4 行
  const p2 = { ...e, items: e.items.slice(5) };
  const { all, rows } = score({ "rx10-1__QA__x__x.json": "{", "rx10-2__QA__x__x.json": p2 });
  assert.equal(Number(all.images), 1);
  assert.equal(Number(all.failed), 1);
  assert.equal(Number(all.missing), 5);
  assert.equal(rowOf(rows, "06").row_ok, "1");
  const p1 = { ...e, items: e.items.slice(0, 5), all_one_dose: false };
  const r2 = score({ "rx10-2__QA__y__x.json": p2, "rx10-1__QA__y__x.json": p1 });
  assert.equal(Number(r2.all.missing), 0);
  assert.equal(Number(r2.all.images_perfect), 1, "1 ページ目は「次ページあり」で All One Dose が無いのが正しい。2 ページ目の true を採る");
});

test("【不具合】ページごとのファイルと、まとめたファイルが同じ撮影名で両方あると、1 つにまとめて行を二重に数える（余分 10）", () => {
  const e = exp("rx05");
  const { all } = score({
    "rx05__QA__x__x.json": e,
    "rx05-1__QA__x__x.json": { ...e, items: e.items.slice(0, 6) },
    "rx05-2__QA__x__x.json": { ...e, items: e.items.slice(6) },
  });
  assert.equal(Number(all.extra), 0);
});
