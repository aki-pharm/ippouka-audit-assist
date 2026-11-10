// 4. 「未確認」の札（candidateToTablet / isUnconfirmed）と、デモ施設 28 品目のつなぎ
import test from "node:test";
import assert from "node:assert/strict";
import { imp, readJson, git } from "./_setup.mjs";

const { candidateToTablet, isUnconfirmed, findCandidates, drugKey, makerLabel } = await imp("lib/makers.ts");
const { loadMaster } = await imp("lib/master.ts");
const index = readJson("data/parent/maker-index.json");
const master = readJson("data/master.json");
const pm = readJson("data/parent/parent-master.json").products;
const byKey = new Map(pm.map((p) => [p.product_key, p]));
const NEW = ["product_key", "drug_key", "maker_state"];

const facility = loadMaster()[0];
const cand = (status) => ({
  product_key: `pk-${status}`, brand_name: "テスト錠5mg「テスト」", maker: "テスト製薬", imprint_front: "T 5", imprint_back: "なし",
  imprint_note: null, color: "白色", color_hex: "#ffffff", shape: "round", size_long_mm: 7, size_short_mm: 7, thickness_mm: 3,
  score_line: false, status, source_url: "https://example.invalid/x.pdf", source_revision: "第1版", verified_by: null, verified_at: null, flags: [],
});

test("4-a. 下書き・添付文書で確認の候補は「未確認」、実物で確認の候補は確認ずみ", () => {
  for (const s of ["draft", "confirmed"]) {
    const t = candidateToTablet(facility, cand(s));
    assert.equal(t.status, "draft", s);
    assert.equal(t.appearance_status, s);
    assert.equal(isUnconfirmed(t), true, s);
  }
  const v = candidateToTablet(facility, cand("verified"));
  assert.equal(v.status, "verified");
  assert.equal(isUnconfirmed(v), false);
  assert.equal(isUnconfirmed(undefined), false);
});

test("4-b. candidateToTablet：外観と出典は候補から、施設の決まり（一包化区分・分包方法・一般名・採用）は施設の行から", () => {
  const c = cand("draft");
  const t = candidateToTablet(facility, c);
  for (const k of ["imprint_front", "imprint_back", "color", "color_hex", "shape", "size_long_mm", "size_short_mm", "thickness_mm", "score_line", "source_url", "source_revision", "brand_name", "product_key"])
    assert.deepEqual(t[k], c[k], k);
  for (const k of ["pack_rule", "pack_rule_reason", "fill_method", "generic_name", "strength", "dosage_form", "adopted", "drug_key"])
    assert.deepEqual(t[k], facility[k], k);
  assert.equal(t.source_page, null); // 施設の行のページ番号を別製品に持ち越さない
  assert.equal(t.source_quote, null);
  assert.deepEqual(t.aliases, []);
  assert.notEqual(t.id, facility.id); // 似た外観の組で、施設の製品と取り違えない
  assert.equal(t.maker, "テスト");
  assert.equal(t.maker_state, "この処方で選択");
});

test("4-c. デモ施設 28 品目はすべて verified のまま、確認ずみ（現物）", () => {
  assert.equal(master.length, 28);
  for (const t of master) {
    assert.equal(t.status, "verified", t.id);
    assert.equal(t.maker_state, "確認ずみ（現物）", t.id);
    assert.equal(isUnconfirmed(t), false, t.id);
  }
});

test("4-d. デモ施設 28 品目：新しい 3 欄以外は origin/main の data/master.json と 1 字も変わらない（欄の並びも）", (t) => {
  const old = JSON.parse(git("show", "origin/main:data/master.json"));
  assert.equal(master.length, old.length);
  let fields = 0;
  for (let i = 0; i < old.length; i++) {
    const a = Object.entries(master[i]).filter(([k]) => !NEW.includes(k));
    assert.deepEqual(a, Object.entries(old[i]), old[i].id);
    fields += a.length;
  }
  t.diagnostic(`比べた欄 ${fields}（28 品目）`);
});

test("4-e. デモ施設 28 品目：product_key は親マスタにあり、drug_key は親マスタの値から作った鍵と同じで、索引のその薬に入っている", (t) => {
  let linked = 0, withCandidates = 0;
  for (const m of master) {
    const p = byKey.get(m.product_key);
    assert.ok(p, `${m.id} 親マスタに無い`);
    assert.equal(m.drug_key, drugKey(p.group, p.strength, p.brand_name), m.id);
    assert.ok(index.drugs[m.drug_key].products.some((x) => x.product_key === m.product_key), m.id);
    linked++;
    if (findCandidates(index, m.drug_key, m.product_key).length) withCandidates++;
  }
  t.diagnostic(`つながった ${linked}/28、他社の候補がある ${withCandidates}/28`);
});

test("4-f. デモ施設 28 品目：つないだ親マスタの製品も verified（メーカー名の書き方の違いは数えるだけ）", (t) => {
  const notVerified = [], makerDiff = [];
  for (const m of master) {
    const p = byKey.get(m.product_key);
    if (p.status !== "verified") notVerified.push(`${m.id}: ${p.status}`);
    if (m.maker && makerLabel(p) !== m.maker) makerDiff.push(`${m.id}: 施設「${m.maker}」／親マスタから「${makerLabel(p)}」`);
  }
  t.diagnostic(`verified でない ${notVerified.length}／メーカー名の書き方が違う ${makerDiff.length}：${makerDiff.join("、")}`);
  assert.deepEqual(notVerified, []);
});

test("4-g. master.csv にも 3 欄があり、master.json と同じ値", () => {
  const csv = git("show", "HEAD:data/master.csv").replace(/^﻿/, "");
  const lines = csv.trim().split("\n");
  const h = lines[0].split(",");
  for (const k of NEW) assert.ok(h.includes(k), k);
  for (const m of master) {
    const line = lines.find((l) => l.startsWith(`${m.id},`));
    assert.ok(line, m.id);
    for (const k of NEW) assert.ok(line.includes(m[k]), `${m.id} ${k}`);
  }
});
