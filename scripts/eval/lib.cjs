/**
 * 品質検査スクリプト共通の小さな道具（scripts/eval/ 専用）
 */
const fs = require("fs");
const path = require("path");

/** 比較用の正規化：null/undefined は ""、全角→半角（NFKC）、空白（全角含む）は全部取り除く */
const norm = (v) => (v == null ? "" : String(v).normalize("NFKC").replace(/[\s　]+/g, ""));

/** 「未確認」または空欄（null / "" / 空白だけ）か */
const isUnconfirmed = (v) => {
  const n = norm(v);
  return n === "" || n === "未確認";
};

/** ディレクトリ内の *.json を名前順に読む */
function readJsonDir(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ file: f, data: JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) }));
}

/** ダブルクォート対応の最小 CSV パーサ（BOM 除去、改行はセル内も可） */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQ = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
      } else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); cell = ""; rows.push(row); row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** CSV の1セル分にエスケープ */
const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Markdown の表のセル（| と改行を潰す） */
const mdCell = (v) => (v == null ? "" : String(v)).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

function mdTable(headers, rows) {
  const lines = [`| ${headers.map(mdCell).join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`];
  for (const r of rows) lines.push(`| ${r.map(mdCell).join(" | ")} |`);
  return lines.join("\n");
}

module.exports = { norm, isUnconfirmed, readJsonDir, parseCsv, csvCell, mdCell, mdTable };
