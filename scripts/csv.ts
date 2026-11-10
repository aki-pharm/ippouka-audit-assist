/**
 * マスタの JSON ↔ CSV 変換（スプレッドシートで確認・修正するため）
 *   npx tsx scripts/csv.ts export   → data/master.csv
 *   npx tsx scripts/csv.ts import   → data/master.csv を data/master.json に反映
 *   npx tsx scripts/csv.ts apply-drafts → data/drafts/*.json の値をマスタに流し込む（status は draft のまま）
 */
import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import { TabletSchema, type Tablet } from "../lib/types";

const JSON_PATH = "data/master.json";
const CSV_PATH = "data/master.csv";
const COLUMNS = Object.keys(TabletSchema.shape) as (keyof Tablet)[];

function load(): Tablet[] {
  return (JSON.parse(fs.readFileSync(JSON_PATH, "utf8")) as unknown[]).map((m) => TabletSchema.parse(m));
}
function save(rows: Tablet[]) {
  fs.writeFileSync(JSON_PATH, JSON.stringify(rows, null, 2) + "\n");
}

const cmd = process.argv[2];
if (cmd === "export") {
  const rows = load().map((t) => Object.fromEntries(COLUMNS.map((c) => [c, Array.isArray(t[c]) ? (t[c] as string[]).join("|") : t[c] ?? ""])));
  fs.writeFileSync(CSV_PATH, "﻿" + Papa.unparse(rows, { columns: COLUMNS as string[] }));
  console.log(`書き出し: ${CSV_PATH}（${rows.length}行）`);
} else if (cmd === "import") {
  const text = fs.readFileSync(CSV_PATH, "utf8").replace(/^﻿/, "");
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  const rows = parsed.data.map((r) => {
    const o: Record<string, unknown> = {};
    for (const c of COLUMNS) {
      const v = r[c] ?? "";
      if (["size_long_mm", "size_short_mm", "thickness_mm", "source_page"].includes(c)) o[c] = v === "" ? null : Number(v);
      else if (["score_line", "adopted"].includes(c)) o[c] = v === "" ? (c === "adopted" ? true : null) : /^(true|1|yes|はい)$/i.test(v);
      else if (c === "aliases") o[c] = v ? v.split("|").map((s) => s.trim()).filter(Boolean) : [];
      else if (["maker", "product_key", "drug_key", "maker_state", "imprint_note", "color_hex", "shape", "pack_rule_reason", "fill_method", "source_url", "source_revision", "source_quote", "verified_by", "verified_at"].includes(c)) o[c] = v === "" ? null : v;
      else o[c] = v;
    }
    return TabletSchema.parse(o);
  });
  save(rows);
  console.log(`取り込み: ${rows.length}行 → ${JSON_PATH}`);
} else if (cmd === "apply-drafts") {
  const master = load();
  const dir = "data/drafts";
  let n = 0;
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const t = master.find((m) => m.id === d.id);
    const p = d.products?.[0];
    if (!t || !p) continue;
    Object.assign(t, {
      imprint_front: p.imprint_front, imprint_back: p.imprint_back, imprint_note: p.imprint_note,
      color: p.color, shape: p.shape, size_long_mm: p.size_long_mm, size_short_mm: p.size_short_mm,
      thickness_mm: p.thickness_mm, score_line: p.score_line, source_revision: p.source_revision, source_page: p.source_page ?? null,
      source_quote: p.source_quote, source_url: d.source_url ?? t.source_url, status: "draft",
    });
    n++;
  }
  save(master);
  console.log(`反映: ${n}件（status は draft のまま。CSVで確認して verified にしてください）`);
} else {
  console.error("使い方: npx tsx scripts/csv.ts export | import | apply-drafts");
  process.exit(1);
}
