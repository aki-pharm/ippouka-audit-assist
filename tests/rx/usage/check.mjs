// 用法の後処理（lib/rxFix.ts の fixUsage など）と、袋の振り分け（lib/packing.ts の toRows・buildBags）を品質が試す。
// node --import <tests/maker/hooks を登録する register> check.mjs <リポジトリ> → JSON
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

const ROOT = process.argv[2];
register(pathToFileURL(path.join(ROOT, "tests/maker/hooks.mjs")).href, { data: { roots: [] } });
const fx = await import(pathToFileURL(path.join(ROOT, "lib/rxFix.ts")).href);
const pk = await import(pathToFileURL(path.join(ROOT, "lib/packing.ts")).href);

const item = (raw, per, dpt = null, dpd = null, extra = {}) => ({
  rp: "01", name_as_written: "テスト錠1mg", name_note: null, strength: "1mg", dosage_form: "tablet", dose_per_time: dpt, times_per_day: null, dose_per_day: dpd,
  per_timing: { morning: per[0], noon: per[1], evening: per[2] }, days: 7, raw_usage_text: raw, pack_instruction: "none", manual_fill_mark: false, confidence: "high", ...extra,
});
const bagsOf = (it) => {
  const rows = pk.toRows({ items: [it], all_one_dose: true, include_all_note: null, notes: null });
  const bags = pk.buildBags(rows, () => ({ tablet: undefined, pending: false }));
  return Object.fromEntries(bags.map((b) => [b.timing, b.entries.reduce((a, e) => a + e.count, 0)]));
};
const fix = (it) => { const f = fx.fixUsage(it); return { per: f.per_timing, unplaced: f.unplaced ?? 0, flags: f.usage_flags ?? [], same: f === it }; };

const out = {};
// 1. 例と並びの読み方
out.examples = [
  ["1-0-2-0-0-0 で投与 1日2回 朝夕食後", [0, 0, 0]],
  ["1-2-0-0-0-0 で投与 1日2回 起床時・朝食後", [0, 0, 0]],
  ["0-0-0-2-0-0 で投与 1日1回 就寝前", [0, 0, 2]],
  ["(2-1-1-1) 朝・昼・夕食後及び就寝前", [2, 1, 1]],
  ["1-0-2-0-0-0 で投与 1日3回 毎食後", [1, 0, 2]],
  ["1-0-2 で投与 1日2回 朝食後・朝食前", [1, 0, 2]],
  ["2-1-2-0-0-0 で投与 1日3回 毎食後", [0, 0, 0]],
  ["１－０－２－０－０－０ で投与 1日2回 朝夕食後", [0, 0, 0]],
  ["1−0−2−0−0−0 で投与 1日2回 朝夕食後", [0, 0, 0]],
  ["1ー0ー2ー0ー0ー0 で投与 1日2回 朝夕食後", [0, 0, 0]],
  ["1‐0‐2‐0‐0‐0 で投与 1日2回 朝夕食後", [0, 0, 0]],
  ["（1-0-2） 1日2回 朝夕食後", [0, 0, 0]],
  ["1回1錠（1日2錠） 28日分 1日2回 朝夕食後", [1, 0, 1]],
  ["1回1錠 1日1回 夕食後（12時間持続）", [0, 0, 1]],
  ["1-1-1 1日3回 8時・14時・20時", [1, 1, 1]],
].map(([t, per]) => ({ text: t, run: fx.parseNumberRun(t), times: fx.parseDoseTimes(t), ...fix(item(t, per)) }));
// 2. 並びの無い寝る前・起床時（綴りの違い）
const spell = ["就寝前", "眠前", "寝る前", "ねる前", "就寝時", "就眠前", "寝前", "睡眠前"];
out.noRun = [];
for (const w of spell) {
  for (const [label, t, per, dpt] of [
    ["寝る前だけ・AI が夕 2", `1回2錠 1日1回 ${w}`, [0, 0, 2], 2],
    ["寝る前だけ・1回量なし・AI が夕 2", `1日1回 ${w}`, [0, 0, 2], null],
    ["夕食後と寝る前・AI が夕 2", `1回1錠 1日2回 夕食後・${w}`, [0, 0, 2], 1],
    ["夕食後と寝る前・正しく夕 1", `1回1錠 1日2回 夕食後・${w}`, [0, 0, 1], 1],
    ["夕食後と寝る前・1回量なし・AI が夕 2", `1日2回 夕食後・${w}`, [0, 0, 2], null],
  ]) out.noRun.push({ word: w, label, text: t, ...fix(item(t, per, dpt)), bags: bagsOf(item(t, per, dpt)) });
}
out.wake = [["起床時だけ・AI が朝 1", "1回1錠 1日1回 起床時", [1, 0, 0], 1], ["起床時と朝・AI が朝 2", "1回1錠 1日2回 起床時・朝食後", [2, 0, 0], 1], ["起床時と朝・正しく朝 1", "1回1錠 1日2回 起床時・朝食後", [1, 0, 0], 1]]
  .map(([label, t, per, dpt]) => ({ label, text: t, ...fix(item(t, per, dpt)), bags: bagsOf(item(t, per, dpt)) }));
// 3. 2 回当てても同じ
out.idempotent = [];
for (const t of [...out.examples.map((x) => x.text), ...out.noRun.map((x) => x.text)]) {
  const a = fx.fixUsage(item(t, [1, 1, 2], 1, 3));
  const b = fx.fixUsage(a);
  out.idempotent.push({ text: t, ok: JSON.stringify(a) === JSON.stringify(b) && b === a });
}
// 4. 正解 145 行：後処理で変わらない（per_timing・欄）
const exp = fs.readdirSync(path.join(ROOT, "data/rx-testset/expected")).flatMap((f) => JSON.parse(fs.readFileSync(path.join(ROOT, "data/rx-testset/expected", f), "utf8")).items.map((it) => ({ f, it })));
out.truth = exp.map(({ f, it }) => { const r = fx.fixUsage(it); return { f, rp: it.rp, text: it.raw_usage_text, changed: JSON.stringify(r.per_timing) !== JSON.stringify(it.per_timing), flags: r.usage_flags ?? [], unplaced: r.unplaced ?? 0 }; });
// 5. 性質の試験：寝る前・起床時の語を含む用法で、AI が夕（朝）に数を入れても、寝る前（起床時）だけの分は夕（朝）の袋に入らない
let seed = 20261112;
const rnd = (n) => ((seed = (seed * 1103515245 + 12345) % 2147483648) % n);
const pick = (a) => a[rnd(a.length)];
out.property = { tried: 0, bad: [] };
for (let k = 0; k < 4000; k++) {
  const bw = pick(["就寝前", "眠前", "寝る前"]);
  const withEve = rnd(2) === 1;
  const d = 1 + rnd(3);
  const useRun = rnd(3) === 0;
  const dosePart = pick([`1回${d}錠 `, ""]);
  const dptField = pick([d, null]);
  const t = useRun ? (withEve ? `0-0-${d}-${d}-0-0 で投与 1日2回 夕食後・${bw}` : `0-0-0-${d}-0-0 で投与 1日1回 ${bw}`) : `${dosePart}1日${withEve ? 2 : 1}回 ${withEve ? `夕食後・${bw}` : bw}`;
  const aiEve = rnd(2 * d + 2);
  const it = item(t, [rnd(2), 0, aiEve], dptField);
  const b = bagsOf(it);
  out.property.tried++;
  const knownDose = useRun || dptField != null || dosePart !== "";
  // 夕の袋に入ってよい上限：寝る前だけなら 0、夕食後もあるなら 1 回量（分かるとき）
  const limit = withEve ? (knownDose ? d : Infinity) : 0;
  if (b.evening > limit) out.property.bad.push(`${t}（AI 夕 ${aiEve}、欄の1回量 ${dptField}）→ 夕の袋 ${b.evening}`);
}
// 正しい夕食後・就寝前は、夕の分を夕の袋に入れる
out.correctEvening = ["1回1錠 1日2回 夕食後・就寝前", "0-0-1-1-0-0 で投与 1日2回 夕食後・就寝前", "1回2錠 1日2回 夕食後・眠前"].map((t, i) => ({ text: t, bags: bagsOf(item(t, [0, 0, i === 2 ? 2 : 1], i === 2 ? 2 : 1)) }));
console.log(JSON.stringify(out));
