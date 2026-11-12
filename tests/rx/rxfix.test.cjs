// lib/rxFix.ts（規格の欄が空なら薬品名から入れる後処理。/api/read-rx とランナーが使う）を品質が独立に試す。
//   node --test tests/rx/
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { ROOT, defs, expectedOf } = require("./helpers.cjs");

const tsOk = Number(process.versions.node.split(".")[0]) >= 22 && process.features?.typescript;
const skip = !tsOk && "Node の TypeScript 読み込みが無い";
const run = (mode, arg) => {
  const r = spawnSync(process.execPath, ["--no-warnings", path.join(__dirname, "rxfix/run.mjs"), ROOT, mode, arg === undefined ? "" : JSON.stringify(arg)], { encoding: "utf8", maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, r.stderr.slice(0, 300));
  return JSON.parse(r.stdout);
};
const S = (names) => run("names", names);

test("正解 145 行：薬品名から取った規格が正解の規格と同じ（配合錠の記号・null も含む）", { skip }, () => {
  const rows = defs().flatMap((d) => expectedOf(d.id).items.map((it) => ({ id: d.id, ...it })));
  assert.equal(rows.length, 145);
  const got = S(rows.map((r) => r.name_as_written));
  const bad = rows.map((r, i) => [r, got[i]]).filter(([r, g]) => g !== r.strength).map(([r, g]) => `${r.id} Rp${r.rp} ${r.name_as_written}：正解 ${r.strength} ／ 名前から ${g}`);
  assert.deepEqual(bad, []);
});

test("数値と単位：0.5mg と 5mg、μg・mcg・µ、mEq、単位、全角、(K)(Ca) の接頭辞、規格の後ろの英字（250mgMT）", { skip }, () => {
  const cases = [
    ["ワーファリン錠0.5mg", "0.5mg"], ["ワーファリン錠5mg", "5mg"], ["メチコバール錠500μg", "500μg"], ["メチコバール錠500µg", "500μg"], ["25mcgチロナミン錠", "25μg"],
    ["グルコンサンK錠5mEq", "5mEq"], ["カリジノゲナーゼ錠50単位「NIG」", "50単位"], ["ワーファリン錠１ｍｇ", "1mg"], ["(K)アスパラカリウム錠300mg", "300mg"],
    ["(Ca)アスパラ-CA錠200mg", "200mg"], ["メトホルミン塩酸塩錠250mgMT「トーワ」", "250mg"], ["10mgセルシン錠", "10mg"], ["アーテン錠（2mg）", "2mg"],
    ["ニフェジピンCR錠20mg「サワイ」", "20mg"], ["アムロジピンOD錠2.5mg「サワイ」", "2.5mg"], ["ジゴシン錠0.125mg", "0.125mg"],
  ];
  assert.deepEqual(S(cases.map((c) => c[0])), cases.map((c) => c[1]));
});

test("名前に規格が無ければ null（推し量らない）：単位の無い数（ファモチジン錠10「サワイ」・リーマス錠200）、配合錠の記号の無いもの、メーカーの「」の中の数（ヨウレチン錠「100」）", { skip }, () => {
  assert.deepEqual(S(["ファモチジン錠10「サワイ」", "リーマス錠200", "ノイロビタン配合錠", "ウラリット配合錠", "ヨウレチン錠「100」", "ビオフェルミンR錠", "ディレグラ配合錠", "アムバロ配合OD錠「トーワ」", "トアラセット配合錠「JG」"]), [null, null, null, null, null, null, null, null, null]);
});

test("配合錠の記号：LD・HD・ULD・EX・AP・A81・T25・L50・1番。OD・CR・メーカーの英字は記号にしない", { skip }, () => {
  const cases = [
    ["ユニシア配合錠HD", "HD"], ["ユニシア配合錠LD", "LD"], ["フリウェル配合錠ULD「あすか」", "ULD"], ["バルヒディオ配合錠EX「JG」", "EX"], ["テルチア配合錠AP「日医工」", "AP"],
    ["バファリン配合錠A81", "A81"], ["エヌケーエスワン配合OD錠T25", "T25"], ["マドパー配合錠L50", "L50"], ["アマルエット配合錠1番「ケミファ」", "1番"],
    ["ジルムロ配合OD錠LD「日医工」", "LD"], ["グルベス配合OD錠", null], ["エックスフォージ配合OD錠", null], ["ロサルヒド配合錠HD「JG」", "HD"],
  ];
  assert.deepEqual(S(cases.map((c) => c[0])), cases.map((c) => c[1]));
});

test("【不具合】配合錠の記号に小数が入ると切れる：クリアミン配合錠S0.5 → 「S0」", { skip, todo: "記号の正規表現 [A-Z]{1,4}\\d* が小数点で止まる。S0.5 のような記号は小数まで取るか、取れないなら null にする（S0 は誤った規格）" }, () => {
  const [s] = S(["クリアミン配合錠S0.5"]);
  assert.ok(s === "S0.5" || s === null, s);
});

test("後処理：規格が入っている行は変えない（名前と違う値でも）。空・空白だけの行だけ入れる。薬品名・ほかの欄・元の結果は変えない", { skip }, () => {
  const it = (name, strength) => ({ rp: "01", name_as_written: name, name_note: null, strength, dosage_form: "tablet", dose_per_time: 1, times_per_day: 1, dose_per_day: 1, per_timing: { morning: 1, noon: 0, evening: 0 }, days: 7, raw_usage_text: "", pack_instruction: "none", manual_fill_mark: false, confidence: "high" });
  const input = { items: [it("アムロジピン錠5mg「サワイ」", "10mg"), it("アムロジピン錠5mg「サワイ」", null), it("ワーファリン錠0.5mg", "  "), it("ノイロビタン配合錠", null), it("ユニシア配合錠HD", ""), it("リーマス錠200", null)], all_one_dose: true, include_all_note: null, notes: null };
  const o = run("fill", input);
  assert.equal(o.mutated, false, "元の結果を変えた");
  assert.deepEqual(o.result.items.map((x) => x.strength), ["10mg", "5mg", "0.5mg", null, "HD", null]);
  assert.equal(o.filled, 3);
  o.result.items.forEach((x, i) => {
    const { strength: a, ...restA } = x;
    const { strength: b, ...restB } = input.items[i];
    assert.deepEqual(restA, restB, `行 ${i}：規格のほかを変えた`);
  });
  for (const k of ["all_one_dose", "include_all_note", "notes"]) assert.deepEqual(o.result[k], input[k]);
});

test("親マスタの全製品（照合のデータにある 7,129 件）：名前から規格が取れたものは親マスタの規格と合う。合わないのは配合錠の記号（決まりどおり）と、親マスタの規格の欠け（チロナミン「25μ」）、上の【不具合】（クリアミン）だけ", { skip }, (t) => {
  const rows = run("parent");
  const nk = (s) => String(s ?? "").normalize("NFKC").replace(/[\s　]/g, "").replace(/µ/g, "μ");
  const amt = (s) => (nk(s).match(/\d+(?:\.\d+)?(?:mg|μg|g|mEq|単位|%)/g) ?? []).map((x) => x.replace(/(\.\d*?)0+(?=\D)/, "$1").replace(/\.(?=\D)/, ""));
  let got = 0, agree = 0;
  const other = [];
  let code = 0;
  for (const [name, ps, s] of rows) {
    if (!s) continue;
    got++;
    if (amt(ps).includes(amt(s)[0] ?? s) || nk(ps).includes(nk(s))) { agree++; continue; }
    if (/配合/.test(name) && !amt(s).length) { code++; continue; } // 配合錠の記号（HD など）。親マスタは成分ごとの量
    other.push(`${name}：名前から ${s} ／ 親マスタ ${ps}`);
  }
  t.diagnostic(`製品 ${rows.length}、名前から取れた ${got}（親マスタと合う ${agree}、配合錠の記号 ${code}）、取れない ${rows.length - got}`);
  assert.ok(rows.length > 7000);
  assert.deepEqual(other.filter((x) => !/チロナミン/.test(x)), []);
});

test("ランナー（scripts/read-rx-batch.ts）もアプリと同じ後処理を使い、入れた行の数を残す", () => {
  const src = require("node:fs").readFileSync(path.join(ROOT, "scripts/read-rx-batch.ts"), "utf8");
  assert.match(src, /await import\("\.\.\/lib\/rxFix"\)/);
  assert.match(src, /fillStrengthFromName\(res\.parsed_output\)/);
});
