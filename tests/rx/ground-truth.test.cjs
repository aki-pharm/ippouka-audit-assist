// 処方箋テストセットの正解（expected/・rows.csv）を prescriptions.json から独立に計算し直して突き合わせる。
//   node --test tests/rx/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DATA, ROOT, defs, expectedOf, rowsCsv, derive, usage, strengthIn, productNames } = require("./helpers.cjs");

const ALL = defs();
const CSV = rowsCsv();

test("処方 20 件・行 145・ページ 24、id は rx01〜rx20 で重複なし", () => {
  assert.equal(ALL.length, 20);
  assert.deepEqual(ALL.map((d) => d.id), Array.from({ length: 20 }, (_, i) => `rx${String(i + 1).padStart(2, "0")}`));
  assert.equal(ALL.reduce((a, d) => a + d.pages.flat().length, 0), 145);
  assert.equal(ALL.reduce((a, d) => a + d.pages.length, 0), 24);
  assert.equal(CSV.length, 145);
  const files = fs.readdirSync(path.join(DATA, "expected")).filter((f) => f.endsWith(".expected.json"));
  assert.equal(files.length, 20);
});

for (const def of ALL) {
  test(`${def.id}: expected.json が定義から計算した値と一致`, () => {
    const want = derive(def).expected;
    const got = expectedOf(def.id);
    assert.equal(got.items.length, want.items.length, "行数");
    assert.equal(got.all_one_dose, want.all_one_dose, "all_one_dose");
    assert.equal(got.include_all_note, want.include_all_note, "include_all_note");
    assert.equal(got.notes, null);
    want.items.forEach((w, i) => {
      const g = got.items[i];
      const where = `${def.id} Rp${w.rp} ${w.name_as_written}`;
      for (const k of ["rp", "name_as_written", "name_note", "strength", "dosage_form", "dose_per_time", "times_per_day", "dose_per_day", "days", "pack_instruction", "manual_fill_mark"]) {
        assert.deepEqual(g[k], w[k], `${where}: ${k}`);
      }
      assert.deepEqual(g.per_timing, w.per_timing, `${where}: per_timing`);
      assert.equal(g.confidence, "high", `${where}: confidence`);
      // 検算：1回量×回数＝1日量（1回量が null の「1-0-2-0-0-0」形式は除く）、朝昼夕＋眠前＝1日量
      if (g.dose_per_time != null) assert.equal(g.dose_per_time * g.times_per_day, g.dose_per_day, `${where}: 1回量×回数`);
      assert.equal(g.per_timing.morning + g.per_timing.noon + g.per_timing.evening + w._slots[3], g.dose_per_day, `${where}: 朝昼夕＋眠前`);
      // 用法の文言：別包の有無、1回量・1日量の数字
      assert.equal(/別包/.test(g.raw_usage_text), g.pack_instruction === "exclude", `${where}: raw_usage_text の別包`);
      if (g.dose_per_time != null) assert.match(g.raw_usage_text, new RegExp(`1回${g.dose_per_time}(錠|Cap)（1日${g.dose_per_day}(錠|Cap)）`), `${where}: raw_usage_text の数`);
      else assert.match(g.raw_usage_text, new RegExp(`${def.pages.flat()[i].u.slice(2)} で投与`), `${where}: raw_usage_text の投与形式`);
      assert.match(g.raw_usage_text, new RegExp(`1日${g.times_per_day}回`), `${where}: raw_usage_text の回数`);
      // 規格は薬品名の中にある文字列
      if (g.strength != null) assert.ok(g.name_as_written.normalize("NFKC").includes(g.strength.normalize("NFKC")), `${where}: 規格が名前に無い`);
    });
  });
}

test("rows.csv の各行（rp・ページ・名前・製品名・全量＝1日量×日数・狙い）が定義から計算した値と一致", () => {
  const want = ALL.flatMap((d) => derive(d).rows);
  const bad = [];
  want.forEach((w, i) => {
    const g = CSV[i];
    const diffs = [];
    if (g.rx !== w.rx || g.rp !== w.rp) diffs.push(`位置 ${g.rx}/${g.rp}`);
    if (Number(g.page) !== w.page) diffs.push(`page ${g.page}≠${w.page}`);
    if (g.name_as_written !== w.name_as_written) diffs.push("name");
    if (g.product !== w.product) diffs.push(`product ${g.product}≠${w.product}`);
    if (Number(g.total) !== w.total) diffs.push(`total ${g.total}≠${w.total}`);
    const gt = g.tricks ? g.tricks.split(" ").sort() : [];
    if (gt.join(" ") !== w.tricks.join(" ")) diffs.push(`tricks ${gt.join(" ")}≠${w.tricks.join(" ")}`);
    if (diffs.length) bad.push(`${w.rx} Rp${w.rp}: ${diffs.join("、")}`);
  });
  assert.deepEqual(bad, []);
});

test("expected の 1日量×日数 が rows.csv の全量と一致（採点の『全量』の基準）", () => {
  const bad = [];
  for (const r of CSV) {
    const e = expectedOf(r.rx).items.find((x) => x.rp === r.rp);
    if (e.dose_per_day * e.days !== Number(r.total)) bad.push(`${r.rx} Rp${r.rp}`);
  }
  assert.deepEqual(bad, []);
});

test("docs/rx-testset.md に書いた狙いごとの行数が rows.csv と一致", () => {
  const count = {};
  for (const r of CSV) for (const t of r.tricks.split(" ").filter(Boolean)) count[t] = (count[t] ?? 0) + 1;
  const doc = { manual_mark: 19, separate_pack: 10, nonuniform_dosing: 8, general_name: 12, page2: 17, lookalike: 11, multi_strength: 14, two_per_dose: 32, odd_days: 43, prefix: 8, brand_generic_stock: 8, name_note: 5, capsule: 9, bedtime: 6, combo: 4, unit_meq: 1 };
  assert.deepEqual(count, doc);
  // 処方単位：All One Dose なし 1（rx11）、「○○も含めて一包化」1（rx12）
  assert.deepEqual(ALL.filter((d) => d.footer === "plain").map((d) => d.id), ["rx11"]);
  assert.deepEqual(ALL.filter((d) => d.include_all_note).map((d) => d.id), ["rx12"]);
});

test("就寝前の行：朝昼夕は眠前を含めない（プロンプトの指示どおり）", () => {
  for (const d of ALL) {
    for (const [i, r] of d.pages.flat().entries()) {
      const { slots } = usage(r.u);
      if (!slots[3]) continue;
      const e = expectedOf(d.id).items[i];
      assert.equal(e.per_timing.morning + e.per_timing.noon + e.per_timing.evening, slots[0] + slots[1] + slots[2], `${d.id} Rp${e.rp}`);
      assert.match(e.raw_usage_text, /就寝前/, `${d.id} Rp${e.rp}`);
    }
  }
});

test("配合錠の規格は印字された記号（AKI 11/11）：ユニシア HD、バファリン A81、ノイロビタン・ウラリットは記号なしで null", () => {
  const e = expectedOf("rx16").items;
  const got = Object.fromEntries(e.filter((x) => x.name_as_written.includes("配合錠")).map((x) => [x.name_as_written, x.strength]));
  assert.deepEqual(got, { "ユニシア配合錠HD": "HD", "ノイロビタン配合錠": null, "ウラリット配合錠": null, "バファリン配合錠A81": "A81" });
  // 記号の無い 2 つは、マスタの製品名にも記号が無い（ほかの記号の製品が無い）
  const names = [...productNames()];
  for (const base of ["ノイロビタン配合錠", "ウラリット配合錠"]) {
    assert.deepEqual(names.filter((n) => n.startsWith(base)), [base], base);
  }
  // ユニシアは LD もあるので、HD の記号が区別に効く
  assert.ok(names.includes("ユニシア配合錠LD"));
});

test("製品名がすべて data/master.json か data/parent/parent-master.json に実在する（145 行）", () => {
  const names = productNames();
  const missing = CSV.filter((r) => !names.has(r.product)).map((r) => `${r.rx} Rp${r.rp} ${r.product}`);
  assert.deepEqual(missing, []);
});

test("製品名の規格が処方の規格と同じ（【般】→製品の対応づけの取り違えがない）", () => {
  const bad = CSV.filter((r) => strengthIn(r.product) !== strengthIn(r.name_as_written)).map((r) => `${r.rx} Rp${r.rp} ${r.name_as_written} → ${r.product}`);
  assert.deepEqual(bad, []);
});

test("【般】の行：製品の剤形が一般名の剤形と合う（口腔内崩壊→OD、徐放 24 時間→CR、12 時間→L）", () => {
  const bad = [];
  for (const d of ALL) for (const r of d.pages.flat()) {
    if (!r.name.startsWith("【般】")) continue;
    assert.ok(r.product, `${d.id} ${r.name}: product が必要`);
    if (/口腔内崩壊/.test(r.name) && !/OD/.test(r.product)) bad.push(`${r.name} → ${r.product}`);
    if (!/口腔内崩壊/.test(r.name) && /OD/.test(r.product)) bad.push(`${r.name} → ${r.product}`);
    if (/徐放/.test(r.name)) {
      if (r.note === "24時間持続" && !/CR/.test(r.product)) bad.push(`${r.name} → ${r.product}`);
      if (r.note === "12時間持続" && !/L錠/.test(r.product)) bad.push(`${r.name} → ${r.product}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("公開リポジトリ：data/private がコミットされていない・テストセットは架空と明記", () => {
  const { execFileSync } = require("node:child_process");
  let tracked = "";
  try {
    tracked = execFileSync("git", ["ls-files", "data/private"], { cwd: ROOT, encoding: "utf8" });
  } catch {
    return; // git が無い環境では確かめない
  }
  assert.equal(tracked.trim(), "");
  assert.equal(execFileSync("git", ["ls-files", "captures"], { cwd: ROOT, encoding: "utf8" }).trim(), "", "captures/ がコミットされている");
  const src = fs.readFileSync(path.join(ROOT, "scripts/make-rx-testset.cjs"), "utf8");
  assert.match(src, /※架空のテスト用データ/);
  assert.match(src, /実在の医療機関・患者とは関係ありません/);
  assert.match(fs.readFileSync(path.join(DATA, "prescriptions.json"), "utf8"), /架空/);
});
