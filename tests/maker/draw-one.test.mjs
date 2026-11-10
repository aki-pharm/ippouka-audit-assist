// 1. 図に描くのは 1 つの薬に 1 製品／5. メーカー未確定は描かない／resolve を渡さないときの動きが origin/main と同じ
import test from "node:test";
import assert from "node:assert/strict";
import { imp, impMain, MAIN_ROOT, readJson, samples } from "./_setup.mjs";

const packing = await imp("lib/packing.ts");
const makers = await imp("lib/makers.ts");
const master = await imp("lib/master.ts");
const index = readJson("data/parent/maker-index.json");
const { buildBags, toRows } = packing;
const { findCandidates, productToDraw, isMakerUnknown } = makers;

/** components/Flow.tsx の resolve と同じ組み立て（findTablet → drug_key ごとの override → productToDraw） */
const flowResolve = (overrides, find = master.findTablet) => (r) => {
  const f = find(r.tablet_id);
  return productToDraw(f, f?.drug_key ? overrides[f.drug_key]?.candidate : null);
};

/** 袋ごとに、同じ薬（drug_key）に製品が 2 つ以上描かれていないか。違反の一覧を返す */
function violations(bags, drugKeyOf) {
  const out = [];
  for (const bag of bags) {
    const byDrug = new Map();
    for (const e of bag.entries) {
      if (!e.tablet) continue;
      const dk = drugKeyOf(e);
      if (!dk) continue;
      const set = byDrug.get(dk) ?? new Set();
      set.add(e.tablet.product_key ?? e.tablet.id);
      byDrug.set(dk, set);
    }
    for (const [dk, set] of byDrug) if (set.size > 1) out.push(`${bag.timing} ${dk}: ${[...set].join(" / ")}`);
  }
  return out;
}
const dkOf = (e) => master.findTablet(e.row.tablet_id)?.drug_key ?? null;

const SAMPLES = samples();

test("見本の処方箋が 1 件以上ある（public/samples/rx-*.expected.json）", () => {
  assert.ok(SAMPLES.length >= 1);
});

test("1-a. 見本の全処方：選択なし（resolve あり）で、どの袋も 1 つの薬に 1 製品", (t) => {
  let entries = 0;
  for (const { name, rx } of SAMPLES) {
    const bags = buildBags(toRows(rx), flowResolve({}));
    entries += bags.reduce((n, b) => n + b.entries.length, 0);
    assert.deepEqual(violations(bags, dkOf), [], name);
  }
  t.diagnostic(`処方 ${SAMPLES.length}、袋の中の薬 ${entries} 件`);
});

test("1-b. 見本の全処方：候補を 1 つずつ選んでも、どの袋も 1 つの薬に 1 製品で、描くのは選んだ製品", (t) => {
  let combos = 0, drawn = 0;
  for (const { name, rx } of SAMPLES) {
    const rows = toRows(rx);
    const keys = [...new Set(rows.map((r) => master.findTablet(r.tablet_id)?.drug_key).filter(Boolean))];
    for (const dk of keys) {
      const cur = master.loadMaster().find((x) => x.drug_key === dk);
      for (const c of findCandidates(index, dk, cur.product_key)) {
        combos++;
        const bags = buildBags(rows, flowResolve({ [dk]: { candidate: c, scope: "今回" } }));
        assert.deepEqual(violations(bags, dkOf), [], `${name} ${dk} → ${c.product_key}`);
        for (const b of bags) for (const e of b.entries) {
          if (dkOf(e) !== dk) continue;
          drawn++;
          assert.equal(e.tablet.product_key, c.product_key);
          assert.equal(e.tablet.brand_name, c.brand_name);
          assert.equal(e.pending, false);
        }
      }
    }
  }
  t.diagnostic(`選んだ組み合わせ ${combos}、選んだ製品として描かれた袋の中の薬 ${drawn}`);
  assert.ok(combos > 0);
});

test("1-c. 見本の全処方：全部の薬を同時に別の候補へ替えても 1 つの薬に 1 製品", () => {
  for (const { name, rx } of SAMPLES) {
    const rows = toRows(rx);
    const ov = {};
    for (const r of rows) {
      const f = master.findTablet(r.tablet_id);
      const c = f?.drug_key ? findCandidates(index, f.drug_key, f.product_key).at(-1) : null;
      if (c) ov[f.drug_key] = { candidate: c, scope: "今回" };
    }
    const bags = buildBags(rows, flowResolve(ov));
    assert.deepEqual(violations(bags, dkOf), [], name);
    for (const b of bags) for (const e of b.entries) {
      const dk = dkOf(e);
      if (dk && ov[dk]) assert.equal(e.tablet.product_key, ov[dk].candidate.product_key);
    }
  }
});

test("1-d. 施設のマスタ（data/master.json）は drug_key が重ならない（同じ薬の 2 製品を並べて描く元が無い）", () => {
  const m = readJson("data/master.json");
  const keys = m.map((t) => t.drug_key).filter(Boolean);
  assert.equal(new Set(keys).size, keys.length);
});

// ---------- 5. メーカー未確定 ----------
test("5-a. isMakerUnknown：未選択・両方使用は true、それ以外と空は false", () => {
  assert.equal(isMakerUnknown("未選択"), true);
  assert.equal(isMakerUnknown("記憶ベース（両方使用）"), true);
  for (const s of ["確認ずみ（現物）", "記憶ベース", "札の読み取り（未確認）", "この処方で選択", null, undefined, ""])
    assert.equal(isMakerUnknown(s), false, String(s));
});

test("5-b. productToDraw：メーカー未確定は tablet なし＋pending、選べば描く、マスタに無ければ従来どおり", () => {
  const base = master.loadMaster()[0];
  const unk = { ...base, maker_state: "未選択" };
  assert.deepEqual(productToDraw(unk, null), { tablet: undefined, pending: true });
  assert.deepEqual(productToDraw({ ...base, maker_state: "記憶ベース（両方使用）" }, undefined), { tablet: undefined, pending: true });
  const c = findCandidates(index, base.drug_key, base.product_key)[0];
  const r = productToDraw(unk, c);
  assert.equal(r.pending, false);
  assert.equal(r.tablet.product_key, c.product_key);
  assert.deepEqual(productToDraw(undefined, null), { tablet: undefined, pending: false });
  assert.deepEqual(productToDraw(base, null), { tablet: base, pending: false });
});

test("5-c. buildBags：メーカー未確定の薬は pending で描かない（他の薬はそのまま描く）", () => {
  const { rx } = SAMPLES[0];
  const rows = toRows(rx);
  const target = rows.find((r) => r.include && r.tablet_id);
  const find = (id) => {
    const t = master.findTablet(id);
    return id === target.tablet_id ? { ...t, maker_state: "記憶ベース（両方使用）" } : t;
  };
  const bags = buildBags(rows, flowResolve({}, find));
  let pending = 0, others = 0;
  for (const b of bags) for (const e of b.entries) {
    if (e.row.tablet_id === target.tablet_id) {
      pending++;
      assert.equal(e.pending, true);
      assert.equal(e.tablet, undefined);
    } else {
      others++;
      assert.equal(e.pending, false);
    }
  }
  assert.ok(pending > 0 && others > 0);
  // 似た外観の組（findSimilar）にも入らない
  for (const b of bags) for (const g of b.groups) assert.ok(!g.tablet_ids.includes(target.tablet_id));
});

// ---------- resolve を渡さないときの動き：origin/main と同じか ----------
const NEW_FIELDS = ["product_key", "drug_key", "maker_state"];
const strip = (t) => t && Object.fromEntries(Object.entries(t).filter(([k]) => !NEW_FIELDS.includes(k)));
const shape = (bags) => bags.map((b) => ({
  timing: b.timing, total: b.total, groups: b.groups,
  entries: b.entries.map((e) => ({ key: e.row.key, tablet: strip(e.tablet), count: e.count, group: e.group})),
}));

test("互換. resolve を渡さない buildBags・toRows の結果が origin/main の lib/packing.ts と同じ（新しい 3 欄を除く）", { skip: !MAIN_ROOT && "origin/main を取り出せない" }, async (t) => {
  const old = await impMain("lib/packing.ts");
  let n = 0;
  for (const { name, rx } of SAMPLES) {
    const rowsNew = toRows(rx), rowsOld = old.toRows(rx);
    assert.deepEqual(rowsNew, rowsOld, `${name} toRows`);
    const a = buildBags(rowsNew), b = old.buildBags(rowsOld);
    assert.deepEqual(shape(a), shape(b), `${name} buildBags`);
    for (const bag of a) for (const e of bag.entries) { assert.equal(e.pending, false); n++; }
  }
  t.diagnostic(`比べた袋の中の薬 ${n} 件（すべて pending=false）`);
});

test("互換. 既定の resolve と、選択なしの Flow の resolve は同じ袋を作る（28 品目はすべて確定）", () => {
  for (const { name, rx } of SAMPLES) {
    const rows = toRows(rx);
    assert.deepEqual(shape(buildBags(rows)), shape(buildBags(rows, flowResolve({}))), name);
  }
});
