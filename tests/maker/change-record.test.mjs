// 7. 「これからはこのメーカー」の変更記録（buildChangeRecord・CSV・JSON）
import test from "node:test";
import assert from "node:assert/strict";
import { imp, readJson } from "./_setup.mjs";

const { buildChangeRecord, changeRecordsToCsv, changeRecordsToJson, findCandidates } = await imp("lib/makers.ts");
const { loadMaster } = await imp("lib/master.ts");
const index = readJson("data/parent/maker-index.json");
const from = loadMaster().find((t) => findCandidates(index, t.drug_key, t.product_key).length);
const to = findCandidates(index, from.drug_key, from.product_key)[0];
const at = new Date("2026-11-10T01:02:03.000Z");

/** RFC 4180 の CSV を読む（テスト用） */
function parseCsv(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

test("7-a. 変更者が空・空白だけなら作らない（エラー）", () => {
  for (const by of ["", "   ", "　"]) assert.throws(() => buildChangeRecord({ drug_key: from.drug_key, from, to, changed_by: by, at }), /変更者/, JSON.stringify(by));
});

test("7-b. 変更記録の中身（前後のメーカー・製品、変更者は前後の空白を除く、日時は ISO 8601）", () => {
  const r = buildChangeRecord({ drug_key: from.drug_key, from, to, changed_by: "  薬剤師A ", at });
  assert.equal(r.drug_key, from.drug_key);
  assert.equal(r.form, from.drug_key.split("|")[2]);
  assert.equal(r.from_product_key, from.product_key);
  assert.equal(r.to_product_key, to.product_key);
  assert.equal(r.changed_by, "薬剤師A");
  assert.equal(r.changed_at, "2026-11-10T01:02:03.000Z");
  assert.equal(r.generic_name, from.generic_name);
  assert.equal(Object.keys(r).length, 10);
});

test("7-c. 今のメーカーが決まっていない・マスタに無いときは「メーカー未確定（…）」で、変更前の製品は null", () => {
  const r = buildChangeRecord({ drug_key: from.drug_key, from: { ...from, maker_state: "記憶ベース（両方使用）" }, to, changed_by: "A", at });
  assert.equal(r.from_maker, "メーカー未確定（記憶ベース（両方使用））");
  assert.equal(r.from_product_key, null);
  const r2 = buildChangeRecord({ drug_key: "X|5|OD錠", from: undefined, to, changed_by: "A", at });
  assert.equal(r2.from_maker, "メーカー未確定（マスタに無い）");
  assert.equal(r2.form, "OD錠");
});

test("7-d. CSV：見出しは 10 列、カンマ・引用符・改行を含む値は囲み、読み直すと元に戻る", () => {
  const base = buildChangeRecord({ drug_key: from.drug_key, from, to, changed_by: "A", at });
  const tricky = { ...base, changed_by: '山田, "太郎"\n2行目', generic_name: "a,b", to_maker: 'x"y', from_product_key: null };
  const csv = changeRecordsToCsv([base, tricky]);
  assert.ok(csv.endsWith("\n"));
  assert.ok(!csv.startsWith("﻿"));
  const rows = parseCsv(csv);
  assert.equal(rows[0].length, 10);
  assert.deepEqual(rows[0], ["薬の鍵", "成分", "規格", "剤形", "変更前のメーカー", "変更前の製品", "変更後のメーカー", "変更後の製品", "変更者", "変更日時"]);
  assert.equal(rows.length, 3);
  const keys = ["drug_key", "generic_name", "strength", "form", "from_maker", "from_product_key", "to_maker", "to_product_key", "changed_by", "changed_at"];
  for (const [i, rec] of [base, tricky].entries()) {
    assert.equal(rows[i + 1].length, 10);
    assert.deepEqual(rows[i + 1], keys.map((k) => (rec[k] == null ? "" : String(rec[k]))));
  }
  assert.ok(csv.includes('"山田, ""太郎""\n2行目"'));
  // 薬の鍵の「|」は囲まなくてよい
  assert.ok(csv.split("\n")[1].startsWith(base.drug_key + ","));
});

test("7-e. CSV：\\r だけを含む値も囲む／記録 0 件なら見出しだけ", () => {
  const base = buildChangeRecord({ drug_key: from.drug_key, from, to, changed_by: "A", at });
  assert.ok(changeRecordsToCsv([{ ...base, changed_by: "a\rb" }]).includes('"a\rb"'));
  assert.equal(changeRecordsToCsv([]).trim().split("\n").length, 1);
});

test("7-f. JSON：読み直すと同じ、2 字下げ、最後に改行", () => {
  const recs = [buildChangeRecord({ drug_key: from.drug_key, from, to, changed_by: 'A,"B"', at })];
  const j = changeRecordsToJson(recs);
  assert.deepEqual(JSON.parse(j), recs);
  assert.ok(j.endsWith("\n"));
  assert.ok(j.includes('\n  {\n    "drug_key"'));
});
