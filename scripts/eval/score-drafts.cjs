/**
 * 下書き（data/drafts/*.json）を、人が確認ずみのマスタ（data/master.json の status=verified）と突き合わせて採点する。
 *   node scripts/eval/score-drafts.cjs
 * 出力：reports/score-drafts.md
 *
 * ルール
 * - 下書きとマスタは id で照合する。下書きの products のうち、マスタと規格（strength）が一致するものを使う
 * - 比べる7項目：imprint_front, imprint_back, color, shape, size_long_mm, size_short_mm, thickness_mm
 * - 比較の前に空白（全角含む）を取り除き、全角英数字は半角に寄せる。数値は数として比べる（7 と 7.0 は同じ）
 * - 結果は3つに分ける
 *     一致            ：正規化した値が同じ
 *     未確認・空欄    ：下書きが「未確認」または空欄（null / ""）で、マスタに値がある（人が埋めた）
 *     誤った値        ：下書きに値があるのに、マスタと違う
 * 期待値に合わせて結果を直すことはしない。数字が合わなければ理由を報告する。
 */
const fs = require("fs");
const path = require("path");
const { norm, isUnconfirmed, readJsonDir, mdTable } = require("./lib.cjs");

const ROOT = path.resolve(__dirname, "../..");
const DRAFTS_DIR = path.join(ROOT, "data/drafts");
const MASTER = path.join(ROOT, "data/master.json");
const REPORT = path.join(ROOT, "reports/score-drafts.md");

const FIELDS = ["imprint_front", "imprint_back", "color", "shape", "size_long_mm", "size_short_mm", "thickness_mm"];
const NUMERIC = new Set(["size_long_mm", "size_short_mm", "thickness_mm"]);
const LABEL = { match: "一致", unconfirmed: "未確認・空欄", wrong: "誤った値" };

/** 1項目の判定 */
function judge(field, draftVal, masterVal) {
  if (NUMERIC.has(field)) {
    const dEmpty = draftVal == null || norm(draftVal) === "";
    const mEmpty = masterVal == null || norm(masterVal) === "";
    if (dEmpty && mEmpty) return "match";
    if (dEmpty) return "unconfirmed";
    if (mEmpty) return "wrong"; // 下書きに値があるのにマスタで消されている
    return Number(norm(draftVal)) === Number(norm(masterVal)) ? "match" : "wrong";
  }
  const d = norm(draftVal);
  const m = norm(masterVal);
  if (d === m) return "match";
  if (isUnconfirmed(draftVal)) return "unconfirmed";
  return "wrong";
}

function scoreDrafts() {
  const master = JSON.parse(fs.readFileSync(MASTER, "utf8"));
  const verified = master.filter((p) => p.status === "verified");
  const byId = new Map(verified.map((p) => [p.id, p]));

  const total = { match: 0, unconfirmed: 0, wrong: 0 };
  const perField = Object.fromEntries(FIELDS.map((f) => [f, { match: 0, unconfirmed: 0, wrong: 0 }]));
  const wrongs = [];
  const unconfirmeds = [];
  const skipped = []; // マスタに無い／規格が合わない下書き
  let compared = 0;

  for (const { file, data: d } of readJsonDir(DRAFTS_DIR)) {
    const m = byId.get(d.id);
    if (!m) { skipped.push({ file, id: d.id, reason: "master.json に verified の同じ id が無い" }); continue; }
    const cands = (d.products || []).filter((p) => norm(p.strength) === norm(m.strength));
    if (cands.length !== 1) {
      skipped.push({ file, id: d.id, reason: `規格 ${m.strength} に一致する product が ${cands.length} 件（${(d.products || []).map((p) => p.strength).join(", ")}）` });
      continue;
    }
    const p = cands[0];
    compared++;
    for (const f of FIELDS) {
      const r = judge(f, p[f], m[f]);
      total[r]++;
      perField[f][r]++;
      const row = { id: d.id, name: m.brand_name, field: f, draft: p[f], master: m[f] };
      if (r === "wrong") wrongs.push(row);
      if (r === "unconfirmed") unconfirmeds.push(row);
    }
  }
  return { verifiedCount: verified.length, compared, total, perField, wrongs, unconfirmeds, skipped };
}

function fmt(v) {
  return v == null ? "null" : String(v) === "" ? '""' : String(v);
}

function writeReport(r) {
  const n = r.compared * FIELDS.length;
  const lines = [];
  lines.push("# 下書きの採点（data/drafts × data/master.json verified）");
  lines.push("");
  lines.push(`実行：${new Date().toISOString()}　スクリプト：scripts/eval/score-drafts.cjs`);
  lines.push("");
  lines.push(`- 照合した品目：${r.compared}（master.json の verified ${r.verifiedCount} 品目）`);
  lines.push(`- 比べた項目：${n}（${r.compared} 品目 × ${FIELDS.length} 項目）`);
  lines.push(`- 一致 ${r.total.match} ／ 未確認・空欄 ${r.total.unconfirmed} ／ 誤った値 ${r.total.wrong}`);
  if (r.skipped.length) lines.push(`- 照合できなかった下書き：${r.skipped.length}`);
  lines.push("");
  lines.push("判定の決め方：空白（全角含む）を取り除き、全角英数字を半角に寄せてから比べる。数値は数として比べる。「未確認・空欄」は下書きが「未確認」か null / \"\" でマスタに値がある（人が埋めた）もの。「誤った値」は下書きに値があるのにマスタと違うもの。");
  lines.push("");
  lines.push("## 項目別");
  lines.push("");
  lines.push(
    mdTable(
      ["項目", "一致", "未確認・空欄", "誤った値", "一致率"],
      FIELDS.map((f) => {
        const c = r.perField[f];
        const t = c.match + c.unconfirmed + c.wrong;
        return [f, c.match, c.unconfirmed, c.wrong, t ? `${((c.match / t) * 100).toFixed(1)}%` : "-"];
      }).concat([["合計", r.total.match, r.total.unconfirmed, r.total.wrong, n ? `${((r.total.match / n) * 100).toFixed(1)}%` : "-"]])
    )
  );
  lines.push("");
  lines.push(`## 誤った値（${r.wrongs.length}）`);
  lines.push("");
  lines.push(r.wrongs.length ? mdTable(["id", "販売名", "項目", "下書き", "マスタ（verified）"], r.wrongs.map((w) => [w.id, w.name, w.field, fmt(w.draft), fmt(w.master)])) : "なし");
  lines.push("");
  lines.push(`## 未確認・空欄（${r.unconfirmeds.length}）`);
  lines.push("");
  lines.push(r.unconfirmeds.length ? mdTable(["id", "販売名", "項目", "下書き", "マスタ（verified）"], r.unconfirmeds.map((w) => [w.id, w.name, w.field, fmt(w.draft), fmt(w.master)])) : "なし");
  if (r.skipped.length) {
    lines.push("");
    lines.push(`## 照合できなかった下書き（${r.skipped.length}）`);
    lines.push("");
    lines.push(mdTable(["ファイル", "id", "理由"], r.skipped.map((s) => [s.file, s.id, s.reason])));
  }
  lines.push("");
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, lines.join("\n"));
}

if (require.main === module) {
  const r = scoreDrafts();
  writeReport(r);
  const n = r.compared * FIELDS.length;
  console.log(`score-drafts: ${r.compared} 品目 × ${FIELDS.length} 項目 = ${n}　一致 ${r.total.match} ／ 未確認・空欄 ${r.total.unconfirmed} ／ 誤った値 ${r.total.wrong}`);
  for (const w of r.wrongs) console.log(`  誤った値: ${w.id} ${w.field}  下書き=${fmt(w.draft)}  マスタ=${fmt(w.master)}`);
  if (r.skipped.length) console.log(`  照合できなかった下書き: ${r.skipped.length}`);
  console.log(`  → ${path.relative(ROOT, REPORT)}`);
}

module.exports = { judge, scoreDrafts, FIELDS };
