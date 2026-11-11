// tests/rx/ の共通の道具。正解の作り方は scripts/make-rx-testset.cjs を読まずに、
// prescriptions.json の _説明 と docs/rx-testset.md の決まりだけから独立に書いた（品質の検算用）。
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const DATA = path.join(ROOT, "data/rx-testset");

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const defs = () => readJson(path.join(DATA, "prescriptions.json")).prescriptions;
const expectedOf = (id) => readJson(path.join(DATA, "expected", `${id}.expected.json`));

/** 最小の CSV 読み（rows.csv 用。ダブルクォート対応） */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let q = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function rowsCsv() {
  const [head, ...rest] = parseCsv(fs.readFileSync(path.join(DATA, "rows.csv"), "utf8")).filter((r) => r.length > 1);
  return rest.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

/**
 * 用法 u を時点ごとの数に直す（独立実装）。
 * 返り値 slots = [朝, 昼, 夕, 眠前]、per = 1回量（"p:" 形式なら null）
 */
function usage(u) {
  if (u.startsWith("p:")) {
    const n = u.slice(2).split("-").map(Number);
    if (n.length !== 6) throw new Error(`p: は 6 つの数: ${u}`);
    // 5・6 番目の時点（起床時など）は今のテストセットでは使わない。使われていたら正解の決め方を見直す必要がある
    if (n[4] || n[5]) throw new Error(`5・6 番目の時点が 0 でない: ${u}`);
    return { per: null, slots: n.slice(0, 4), pattern: u.slice(2) };
  }
  const m = /^(\d+) ((?:M|N|E|HS|\+)+)$/.exec(u);
  if (!m) throw new Error(`用法が読めない: ${u}`);
  const per = Number(m[1]);
  const code = m[2];
  const hs = code.includes("HS");
  const meals = code.replace("HS", "").replace(/\+/g, "");
  const slots = [meals.includes("M") ? per : 0, meals.includes("N") ? per : 0, meals.includes("E") ? per : 0, hs ? per : 0];
  return { per, slots, pattern: null };
}

const PREFIX = /^\((K|Ca|Na)\)/;
/**
 * 規格：名前の中の「数字＋mg/μg/mEq/g」。
 * 単位つきの数が無い配合錠は、「配合錠」の直後に印字された英数字の記号（HD・A81 など。11/11 AKI の判断）。それも無ければ null
 */
const strengthIn = (name) => {
  const n = name.normalize("NFKC").replace(/µ/g, "μ");
  const m = /(\d+(?:\.\d+)?)(mg|μg|mEq|g)/.exec(n);
  if (m) return m[1] + m[2];
  const i = n.indexOf("配合錠");
  if (i < 0) return null;
  const code = /^[0-9A-Za-z]+/.exec(n.slice(i + 3));
  return code ? code[0] : null;
};

/** prescriptions.json の 1 処方 → 期待する expected.json と rows.csv の行（独立に計算） */
function derive(def) {
  const items = [];
  const rows = [];
  let n = 0;
  def.pages.forEach((page, pi) => {
    for (const r of page) {
      n++;
      const rp = String(n).padStart(2, "0");
      const { per, slots } = usage(r.u);
      const days = r.days ?? def.days;
      const perDay = slots.reduce((a, b) => a + b, 0);
      const capsule = r.name.includes("カプセル");
      items.push({
        rp,
        name_as_written: r.name,
        name_note: r.note ?? null,
        strength: strengthIn(r.name),
        dosage_form: capsule ? "capsule" : "tablet",
        dose_per_time: per,
        times_per_day: slots.filter((x) => x > 0).length,
        dose_per_day: perDay,
        per_timing: { morning: slots[0], noon: slots[1], evening: slots[2] },
        days,
        pack_instruction: r.sep ? "exclude" : "none",
        manual_fill_mark: !!r.mark,
        _slots: slots,
      });
      const tricks = new Set(r.tricks ?? []);
      if (r.mark) tricks.add("manual_mark");
      if (r.sep) tricks.add("separate_pack");
      if (r.u.startsWith("p:")) tricks.add("nonuniform_dosing");
      if (r.name.startsWith("【般】")) tricks.add("general_name");
      if (PREFIX.test(r.name)) tricks.add("prefix");
      if (Math.max(...slots) >= 2) tricks.add("two_per_dose");
      if (days % 7 !== 0 && days !== 30) tricks.add("odd_days");
      if (pi > 0) tricks.add("page2");
      if (r.note) tricks.add("name_note");
      if (capsule) tricks.add("capsule");
      if (slots[3] > 0) tricks.add("bedtime");
      rows.push({
        rx: def.id, rp, page: pi + 1, name_as_written: r.name,
        product: r.product ?? r.name.replace(PREFIX, ""),
        total: perDay * days, tricks: [...tricks].sort(),
      });
    }
  });
  return {
    expected: { items, all_one_dose: def.footer !== "plain", include_all_note: def.include_all_note ?? null, notes: null },
    rows,
  };
}

function productNames() {
  const names = new Set();
  for (const t of readJson(path.join(ROOT, "data/master.json"))) names.add(t.brand_name);
  for (const p of readJson(path.join(ROOT, "data/parent/parent-master.json")).products) names.add(p.brand_name);
  return names;
}

module.exports = { ROOT, DATA, readJson, defs, expectedOf, rowsCsv, usage, derive, strengthIn, productNames, parseCsv };
