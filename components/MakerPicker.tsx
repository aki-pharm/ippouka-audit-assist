"use client";
import { useState } from "react";
import {
  APPEARANCE_STATUS_LABEL,
  changeRecordsToCsv,
  changeRecordsToJson,
  isMakerUnknown,
  makerLabel,
  type ChangeRecord,
  type MakerCandidate,
  type ParentStatus,
} from "@/lib/makers";
import type { Tablet } from "@/lib/types";
import { previousAdopted } from "@/lib/master";

export type MakerScope = "今回だけ" | "これから";
export type MakerOverride = { candidate: MakerCandidate; scope: MakerScope };


/** 刻印を 1 行の短い文字に（表／裏。「なし」「未確認」はそのまま） */
function imprintLine(front: string, back: string): string {
  return `表 ${front || "未確認"}／裏 ${back || "未確認"}`;
}

/**
 * 表の 1 行に出す「対応する製品」の選び方（マスタの対応品と、今のメーカー／変更を 1 つにしたもの）。
 * 開くと、同じ成分・規格・剤形の製品を、施設の採用品 → 採用外（親マスタの他社。/api/makers から取る）の順に文字だけで出す。
 * いちばん下の「別の薬から探す」で、施設のマスタ全体から選び直せる（読み取りが別の薬を選んだとき）。
 * 施設の採用品を選ぶと対応品（tablet_id）が変わり、採用外を選ぶと「今回だけ／これからはこのメーカー」でメーカーを変える（図に描くのは 1 製品）。
 */
export function DrugPicker({
  facility,
  sameDrug,
  master,
  matchNote,
  override,
  onChoose,
  onSelectTablet,
  changedBy,
  setChangedBy,
}: {
  facility: Tablet | undefined;
  /** 照合の候補と、同じ薬（drug_key）の施設の採用品 */
  sameDrug: Tablet[];
  master: Tablet[];
  /** 照合の一言（候補にとどめた理由・事前合意など） */
  matchNote: string | null | undefined;
  override: MakerOverride | null;
  onChoose: (c: MakerCandidate | null, scope: MakerScope) => void;
  onSelectTablet: (id: string | null) => void;
  changedBy: string;
  setChangedBy: (s: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<MakerCandidate[] | null>(null);
  const [picked, setPicked] = useState<MakerCandidate | null>(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");

  const unknown = isMakerUnknown(facility?.maker_state);
  const previous = previousAdopted(facility?.drug_key); // メーカー切替で採用をやめた製品（「以前の採用」の札）
  const adoptedKeys = new Set(sameDrug.map((t) => t.product_key ?? t.brand_name));
  const outside = (candidates ?? []).filter((c) => !adoptedKeys.has(c.product_key)); // 採用外（親マスタの他社）

  async function openList() {
    setOpen(true);
    setPicked(null);
    setSearching(false);
    if (candidates || !facility?.drug_key) return;
    setBusy(true);
    setError(null);
    try {
      const q = new URLSearchParams({ drug: facility.drug_key });
      if (facility.product_key && !unknown) q.set("current", facility.product_key);
      const res = await fetch(`/api/makers?${q}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `候補を読めませんでした（${res.status}）`);
      setCandidates(json.candidates as MakerCandidate[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function choose(scope: MakerScope) {
    if (!picked) return;
    onChoose(picked, scope);
    setOpen(false);
    setPicked(null);
  }
  function selectTablet(id: string | null) {
    onSelectTablet(id);
    setOpen(false);
    setSearching(false);
  }

  const shownName = override ? override.candidate.brand_name : facility?.brand_name;
  const shownUnverified = override ? override.candidate.status !== "verified" : facility ? facility.status !== "verified" : false;
  const q = query.normalize("NFKC").trim().toLowerCase();
  const hits = q ? master.filter((m) => `${m.brand_name}${m.generic_name}`.normalize("NFKC").toLowerCase().includes(q)) : master;

  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 leading-snug">
          <div className="text-slate-500">対応する製品</div>
          {shownName ? (
            <div className="flex flex-wrap items-center gap-1">
              <b className="text-sm">{shownName}</b>
              {shownUnverified && <span className="rounded bg-amber-500 px-1 text-white">未確認</span>}
              {unknown && !override && <span className="rounded bg-amber-500 px-1 font-bold text-white">メーカー未確定</span>}
              {override && (
                <span className="rounded bg-violet-600 px-1 text-white">{override.scope === "今回だけ" ? "今回だけ" : "これからはこのメーカー（記録のみ）"}</span>
              )}
            </div>
          ) : (
            <b className="text-sm text-amber-900">（選ばれていません）</b>
          )}
        </div>
        <button type="button" onClick={() => (open ? setOpen(false) : openList())} className="shrink-0 rounded-lg border border-blue-600 bg-white px-3 py-2 text-sm font-bold text-blue-800">
          {open ? "閉じる" : "変更"}
        </button>
      </div>
      {unknown && !override && <div className="mt-1 text-amber-900">今のメーカーが 1 つに決まっていません。「変更」で選ぶまで、図にはこの薬を描きません。</div>}
      {override && (
        <button type="button" onClick={() => onChoose(null, override.scope)} className="mt-1 rounded border border-slate-300 bg-white px-2 py-1">
          元に戻す（{facility?.brand_name}）
        </button>
      )}
      {open && !searching && (
        <div className="mt-2 space-y-2">
          {matchNote && <p className="rounded bg-white px-2 py-1 text-slate-700">{matchNote}</p>}
          {sameDrug.length > 0 && <div className="font-semibold text-slate-600">施設の採用品</div>}
          <ul className="space-y-1">
            {sameDrug.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  aria-pressed={t.id === facility?.id && !override}
                  onClick={() => selectTablet(t.id)}
                  className={`w-full rounded-lg border px-2 py-2 text-left ${t.id === facility?.id && !override ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white"}`}
                >
                  <div className="flex flex-wrap items-center gap-1">
                    <b className="text-sm">{makerLabel(t)}</b>
                    <span className="text-slate-600">{t.brand_name}</span>
                    {t.status !== "verified" && <span className="rounded bg-amber-500 px-1 text-white">未確認</span>}
                    {isMakerUnknown(t.maker_state) && <span className="rounded bg-amber-500 px-1 text-white">メーカー未確定</span>}
                  </div>
                  <div className="font-mono text-slate-700">{imprintLine(t.imprint_front, t.imprint_back)}</div>
                </button>
              </li>
            ))}
          </ul>
          {busy && <p className="text-slate-500">採用外の製品を読んでいます…</p>}
          {error && <p className="text-red-700">{error}</p>}
          {outside.length > 0 && <div className="font-semibold text-slate-600">採用外（同じ成分・規格・剤形の他社）</div>}
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {outside.map((c) => {
              const sel = picked?.product_key === c.product_key;
              return (
                <li key={c.product_key}>
                  <button
                    type="button"
                    aria-pressed={sel}
                    onClick={() => setPicked(sel ? null : c)}
                    className={`w-full rounded-lg border px-2 py-2 text-left ${sel ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white"}`}
                  >
                    <div className="flex flex-wrap items-center gap-1">
                      <b className="text-sm">{makerLabel(c)}</b>
                      <span className="rounded bg-slate-500 px-1 text-white">採用外</span>
                      {c.status !== "verified" && <span className="rounded bg-amber-500 px-1 text-white">未確認</span>}
                      {previous.has(c.product_key) && <span className="rounded bg-slate-500 px-1 text-white">以前の採用</span>}
                    </div>
                    <div className="font-mono text-slate-700">{imprintLine(c.imprint_front, c.imprint_back)}</div>
                  </button>
                </li>
              );
            })}
          </ul>
          {picked && facility && (
            <div className="space-y-2 rounded-lg border border-blue-300 bg-white p-2">
              <div>
                選んだ製品：<b>{picked.brand_name}</b>
                {picked.status !== "verified" && <span className="ml-1 rounded bg-amber-500 px-1 text-white">未確認</span>}
              </div>
              {picked.source_url && (
                <a href={picked.source_url} target="_blank" rel="noopener noreferrer" className="block rounded-lg bg-blue-700 py-2 text-center font-bold text-white">
                  添付文書（PDF）で刻印を確かめる
                </a>
              )}
              <button type="button" onClick={() => choose("今回だけ")} className="w-full rounded-lg bg-emerald-700 py-2 text-sm font-bold text-white">
                今回だけ（この処方だけ図を変える）
              </button>
              <label className="block text-slate-600">
                変更者
                <input
                  value={changedBy}
                  onChange={(e) => setChangedBy(e.target.value)}
                  placeholder="名前またはイニシャル"
                  className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-base"
                />
              </label>
              <button
                type="button"
                disabled={!changedBy.trim()}
                onClick={() => choose("これから")}
                className="w-full rounded-lg border border-violet-600 bg-white py-2 text-sm font-bold text-violet-800 disabled:opacity-40"
              >
                これからはこのメーカー（変更の記録を作る）
              </button>
              <p className="text-slate-500">「これから」はまだ保存しません。変更の記録を作るだけです。記録を確認係に渡すと、運用マスタに反映されます。</p>
            </div>
          )}
          {!facility?.drug_key && sameDrug.length === 0 && <p className="text-slate-500">同じ成分・規格・剤形の製品が分かりません。下の「別の薬から探す」で選んでください。</p>}
          <button type="button" onClick={() => setSearching(true)} className="w-full rounded-lg border border-slate-400 bg-white py-2 text-sm text-slate-700">
            別の薬から探す（施設のマスタ全体）
          </button>
        </div>
      )}
      {open && searching && (
        <div className="mt-2 space-y-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="薬品名・一般名で絞り込む"
            className="w-full rounded border border-slate-300 px-2 py-2 text-base"
          />
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            <li>
              <button type="button" onClick={() => selectTablet(null)} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-left text-slate-600">
                （該当なし・未選択）
              </button>
            </li>
            {hits.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => selectTablet(m.id)} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-left">
                  <span className="text-sm">{m.brand_name}</span>
                  {m.status !== "verified" && <span className="ml-1 rounded bg-amber-500 px-1 text-white">未確認</span>}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setSearching(false)} className="w-full rounded-lg border border-slate-300 py-2">
            同じ薬の一覧に戻る
          </button>
        </div>
      )}
    </div>
  );
}

export function StatusBadge({ status }: { status: ParentStatus }) {
  const cls = status === "verified" ? "bg-emerald-600" : status === "confirmed" ? "bg-sky-600" : "bg-amber-500";
  return <span className={`rounded px-1 text-white ${cls}`}>{APPEARANCE_STATUS_LABEL[status]}</span>;
}

/** 「これからはこのメーカー」の変更記録。保存はまだしないので、JSON か CSV の文字として確認係に渡す */
export function ChangeLog({ records, onRemove }: { records: ChangeRecord[]; onRemove: (i: number) => void }) {
  const [format, setFormat] = useState<"json" | "csv">("csv");
  if (records.length === 0) return null;
  const text = format === "json" ? changeRecordsToJson(records) : changeRecordsToCsv(records);

  function download() {
    // CSV は表計算ソフトで文字化けしないよう BOM をつける
    const blob = new Blob([format === "csv" ? "﻿" + text : text], { type: format === "csv" ? "text/csv" : "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `maker-changes-${new Date().toISOString().slice(0, 10)}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rounded-xl border border-violet-400 bg-violet-50 p-3 text-sm">
      <div className="font-semibold">メーカーの変更の記録（{records.length} 件）</div>
      <p className="mt-1 rounded bg-white px-2 py-1 text-xs text-violet-900">
        保存はまだ作っていません。マスタは変わりません。この記録をダウンロードするか文字をコピーして、確認係に渡してください。画面を閉じると消えます。
      </p>
      <ul className="mt-2 space-y-1 text-xs">
        {records.map((r, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="min-w-0 flex-1">
              {r.generic_name} {r.strength} {r.form}：{r.from_maker} → <b>{r.to_maker}</b>（{r.changed_by}、{r.changed_at.slice(0, 16).replace("T", " ")}）
            </span>
            <button type="button" onClick={() => onRemove(i)} className="shrink-0 rounded border border-slate-300 bg-white px-2">取り消す</button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex rounded-lg border border-slate-300 bg-white p-1 text-xs" role="group" aria-label="記録の形式">
        {(["csv", "json"] as const).map((f) => (
          <button key={f} type="button" aria-pressed={format === f} onClick={() => setFormat(f)} className={`flex-1 rounded px-2 py-1 ${format === f ? "bg-slate-800 font-bold text-white" : "text-slate-700"}`}>
            {f.toUpperCase()}
          </button>
        ))}
      </div>
      <textarea readOnly value={text} rows={Math.min(10, records.length + 3)} className="mt-2 w-full rounded border border-slate-300 bg-white p-2 font-mono text-[11px]" onFocus={(e) => e.currentTarget.select()} />
      <button type="button" onClick={download} className="mt-1 w-full rounded-lg bg-violet-700 py-2 font-bold text-white">
        {format.toUpperCase()} をダウンロード
      </button>
    </div>
  );
}
