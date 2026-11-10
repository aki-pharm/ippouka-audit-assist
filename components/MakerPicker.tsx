"use client";
import { useState } from "react";
import {
  APPEARANCE_STATUS_LABEL,
  candidateToTablet,
  changeRecordsToCsv,
  changeRecordsToJson,
  isMakerUnknown,
  makerLabel,
  type ChangeRecord,
  type MakerCandidate,
  type ParentStatus,
} from "@/lib/makers";
import type { Tablet } from "@/lib/types";
import { TabletSvg, sizeText } from "./Tablet";

export type MakerScope = "今回だけ" | "これから";
export type MakerOverride = { candidate: MakerCandidate; scope: MakerScope };

const SHAPE_LABEL: Record<string, string> = { round: "円形", oval: "楕円形", oblong: "長円形", other: "その他" };

/**
 * 表の 1 行に出す「今のメーカー」と「変更」。
 * 候補は /api/makers から、その薬の分だけ取る（親マスタ全体は画面に持たない）。
 */
export function MakerPicker({
  facility,
  override,
  onChoose,
  changedBy,
  setChangedBy,
}: {
  facility: Tablet | undefined;
  override: MakerOverride | null;
  onChoose: (c: MakerCandidate | null, scope: MakerScope) => void;
  changedBy: string;
  setChangedBy: (s: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<MakerCandidate[] | null>(null);
  const [picked, setPicked] = useState<MakerCandidate | null>(null);

  if (!facility) return null;
  const unknown = isMakerUnknown(facility.maker_state);

  async function openList() {
    setOpen(true);
    setPicked(null);
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

  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-slate-500">今のメーカー：</span>
          {unknown ? (
            <span className="rounded bg-amber-500 px-1 font-bold text-white">メーカー未確定</span>
          ) : (
            <b>{makerLabel(facility)}</b>
          )}
          {facility.maker_state && <span className="ml-1 text-slate-500">（{facility.maker_state}）</span>}
        </div>
        {facility.drug_key ? (
          <button type="button" onClick={() => (open ? setOpen(false) : openList())} className="shrink-0 rounded-lg border border-blue-600 bg-white px-3 py-1.5 text-sm font-bold text-blue-800">
            {open ? "閉じる" : "変更"}
          </button>
        ) : (
          <span className="shrink-0 text-slate-400">他社の候補なし（親マスタにつながっていません）</span>
        )}
      </div>
      {unknown && !override && (
        <div className="mt-1 text-amber-900">今のメーカーが 1 つに決まっていません。「変更」で選ぶまで、図にはこの薬を描きません。</div>
      )}
      {override && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <span className="text-slate-500">この処方では：</span>
          <b>{makerLabel(override.candidate)}</b>
          <span className="rounded bg-violet-600 px-1 text-white">{override.scope === "今回だけ" ? "今回だけ" : "これからはこのメーカー（記録のみ）"}</span>
          <StatusBadge status={override.candidate.status} />
          <button type="button" onClick={() => onChoose(null, override.scope)} className="ml-auto rounded border border-slate-300 bg-white px-2 py-1">
            元に戻す
          </button>
        </div>
      )}
      {open && (
        <div className="mt-2 space-y-2">
          {busy && <p className="text-slate-500">候補を読んでいます…</p>}
          {error && <p className="text-red-700">{error}</p>}
          {candidates && candidates.length === 0 && <p className="text-slate-500">同じ成分・規格・剤形の他社製品は親マスタにありません。</p>}
          {candidates && candidates.length > 0 && (
            <p className="text-slate-600">同じ成分・規格・剤形の製品 {candidates.length} 件。刻印・色・大きさは添付文書由来の親マスタの値です。</p>
          )}
          <ul className="max-h-96 space-y-2 overflow-y-auto">
            {candidates?.map((c) => {
              const sel = picked?.product_key === c.product_key;
              const t = candidateToTablet(facility, c);
              return (
                <li key={c.product_key}>
                  <button
                    type="button"
                    aria-pressed={sel}
                    onClick={() => setPicked(sel ? null : c)}
                    className={`flex w-full items-center gap-2 rounded-lg border p-2 text-left ${sel ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white"}`}
                  >
                    <div className="flex w-20 shrink-0 justify-center">
                      {facility.dosage_form === "capsule" ? <span className="text-slate-400">カプセル</span> : <TabletSvg tablet={t} caption={false} />}
                    </div>
                    <div className="min-w-0 flex-1 leading-snug">
                      <div className="flex flex-wrap items-center gap-1">
                        <b className="text-sm">{makerLabel(c)}</b>
                        <StatusBadge status={c.status} />
                      </div>
                      <div className="text-slate-600">{c.brand_name}</div>
                      <div className="font-mono">表 {c.imprint_front} ／ 裏 {c.imprint_back}</div>
                      <div>
                        {c.color}・{c.shape ? SHAPE_LABEL[c.shape] : "形 未確認"}・{c.size_long_mm != null ? `長径 ${c.size_long_mm}mm` : sizeText(t)}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
          {picked && (
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
