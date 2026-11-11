// 8. 索引 data/parent/maker-index.json の再現性と、施設の非公開データが入っていないこと
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { REPO, git, readJson } from "./_setup.mjs";

const committed = readJson("data/parent/maker-index.json");
const pm = readJson("data/parent/parent-master.json");

/** 一時ディレクトリに入力だけを写して scripts/build-maker-index.cjs を動かす（リポジトリのファイルは書きかえない） */
function buildInTemp(args = [], masterJson = null) {
  const dir = mkdtempSync(path.join(tmpdir(), "maker-index-"));
  mkdirSync(path.join(dir, "data/parent"), { recursive: true });
  for (const f of readdirSync(path.join(REPO, "data/parent")))
    if (f === "parent-master.json" || (f.startsWith("naifuku-tablets-") && f.endsWith(".csv")))
      copyFileSync(path.join(REPO, "data/parent", f), path.join(dir, "data/parent", f));
  if (masterJson != null) writeFileSync(path.join(dir, "data/master.json"), masterJson);
  const out = execFileSync(process.execPath, [path.join(REPO, "scripts/build-maker-index.cjs"), ...args], { cwd: dir, encoding: "utf8" });
  return { dir, out, index: JSON.parse(readFileSync(path.join(dir, "data/parent/maker-index.json"), "utf8")) };
}
const noTime = ({ built_at, ...rest }) => rest;

test("8-a. 作り直した索引が commit された索引と同じ（built_at を除く）", (t) => {
  const { index, out } = buildInTemp();
  t.diagnostic(out.trim());
  assert.deepEqual(noTime(index), noTime(committed));
  // 文字列としても同じ（キーの順・数値の書き方まで）
  const s = (o) => JSON.stringify(noTime(o));
  assert.equal(s(index), s(committed));
});

test("8-b. --link-master：origin/main の data/master.json から作り直すと、ブランチの data/master.json と同じ（28/28）", (t) => {
  const { dir, out } = buildInTemp(["--link-master"], git("show", "origin/main:data/master.json"));
  t.diagnostic(out.trim().split("\n").at(-1));
  assert.equal(readFileSync(path.join(dir, "data/master.json"), "utf8"), readFileSync(path.join(REPO, "data/master.json"), "utf8"));
  assert.match(out, /28\/28/);
});

test("8-c. --link-master は 2 回目でも変わらない（すでにある欄を上書きしない）", () => {
  const { dir } = buildInTemp(["--link-master"], readFileSync(path.join(REPO, "data/master.json"), "utf8"));
  assert.equal(readFileSync(path.join(dir, "data/master.json"), "utf8"), readFileSync(path.join(REPO, "data/master.json"), "utf8"));
});

test("8-d. 索引は採用品で絞っていない：親マスタの全製品（外観の下書きなしを除く）が入っている", (t) => {
  // 製品でない行（患者向け・医療従事者向けの資材など。29b5729 で索引から除いた）は数えない。除かれた行が本当に資材かを品質の読み方で確かめる
  const material = /患者|ご家族|皆様|みなさま|方へ|へ$|医療従事者|資材|携帯カード|適正|運用手順|ガイド|お願い|注意いただきたい|ください|いただく|にあたって|との併用|について|治療を受け|服用され/; // 品質の読み方（文の形・資材の言葉）
  const indexed = new Set(Object.values(committed.drugs).flatMap((d) => d.products.map((p) => p.product_key)));
  const dropped = pm.products.filter((p) => p.status !== "none" && !indexed.has(p.product_key));
  for (const p of dropped) assert.match(p.brand_name.normalize("NFKC"), material, `製品なのに索引に無い: ${p.brand_name}`);
  assert.ok(dropped.length <= 20, `除いた行 ${dropped.length}`);
  const all = pm.products.filter((p) => p.status !== "none" && !material.test(p.brand_name.normalize("NFKC"))).map((p) => p.product_key);
  const inIndex = Object.values(committed.drugs).flatMap((d) => d.products.map((p) => p.product_key));
  t.diagnostic(`親マスタ ${pm.products.length} 製品（うち下書きなし ${pm.products.length - all.length}）、索引 ${inIndex.length} 製品、薬 ${committed.drug_count}`);
  // 資材の行が索引に残っていても、ここでは数えない（下の【不具合】で見る）
  const isMaterialKey = new Set(pm.products.filter((p) => material.test(p.brand_name.normalize("NFKC"))).map((p) => p.product_key));
  const inIndexProducts = inIndex.filter((k) => !isMaterialKey.has(k));
  assert.deepEqual([...new Set(inIndexProducts)].sort(), [...new Set(all)].sort());
  assert.equal(inIndexProducts.length, all.length);
});

test("直った：製品でない行（資材）が索引に残る：「オンジェンティス錠を適正にご使用いただくために」（マルシロンの携帯カードは直った）", () => {
  const names = Object.values(committed.drugs).flatMap((d) => d.products.map((p) => p.brand_name));
  assert.deepEqual(names.filter((n) => /患者|ご家族|皆様|みなさま|方へ|へ$|医療従事者|資材|携帯カード|適正|運用手順|ガイド|お願い|注意いただきたい|ください|いただく|にあたって|との併用|について|治療を受け|服用され/.test(n.normalize("NFKC"))), []);
});

test("8-e. 索引の製品の欄は公開の親マスタ由来のものだけ（採用・カセット・分包方法などの欄が無い）", (t) => {
  const allowed = new Set(["product_key", "brand_name", "maker", "imprint_front", "imprint_back", "imprint_note", "color", "color_hex", "shape", "size_long_mm", "size_short_mm", "thickness_mm", "score_line", "status", "source_url", "source_revision", "verified_by", "verified_at", "flags"]);
  const seen = new Set();
  for (const d of Object.values(committed.drugs)) {
    assert.deepEqual(Object.keys(d).sort(), ["form", "generic_name", "products", "strength"]);
    for (const p of d.products) for (const k of Object.keys(p)) seen.add(k);
  }
  t.diagnostic(`使われている欄：${[...seen].join(", ")}`);
  for (const k of seen) assert.ok(allowed.has(k), k);
  // 欄の名前に施設の運用の欄が無い（本文の「カセット」等の語は親マスタの刻印の補足の文で、8-a で親マスタから作り直せることを確かめている）
  for (const k of seen) assert.ok(!/cassette|adopted|fill|pack|maker_state|private/.test(k), k);
});

test("8-f. data/private/ は commit されていない（git ls-files が 0 件）、ブランチの差分にも無い", () => {
  assert.equal(git("ls-files", "data/private").trim(), "");
  assert.ok(!git("diff", "--name-only", "origin/main...HEAD").split("\n").some((f) => f.startsWith("data/private")));
});
