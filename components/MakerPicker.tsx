"use client";
import { useState } from "react";
import {
  APPEARANCE_STATUS_LABEL,
  changeRecordsToCsv,
  changeRecordsToJson,
  isMakerUnknown,
  type ChangeRecord,
  type MakerCandidate,
  type ParentStatus,
} from "@/lib/makers";
import type { Tablet } from "@/lib/types";
import { previousAdopted } from "@/lib/master";
import { buildRuleOverrideRecord, type RuleOverrideRecord } from "@/lib/matching";
import { needsOverrideRecord, overrideRule } from "@/lib/pick";
// 刻印は見分けに役立つものだけ（名前の印字は「名前印字」）、製品の呼び名は「」のメーカー・先発品は販売名（lib/display.ts）
import { imprintSummary, productLabel } from "@/lib/display";

/** 一覧の札（lib/matching.ts の explainCandidate の結果） */
export type Explained = { kind: "auto" | "candidate" | "ruleOut" | "discontinued" | "other"; reason: string | null };

export type MakerScope = "今回だけ" | "これから";
export type MakerOverride = { candidate: MakerCandidate; scope: MakerScope };



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
  explain,
  rxName,
  onOverrideRecord,
  matchNote,
  override,
  onChoose,
  onSelectTablet,
  changedBy,
  setChangedBy,
}: {
  facility: Tablet | undefined;
  /** 照合の候補と、同じ薬（drug_key）の施設の採用品。1 件ずつ選んだらどうなるかの札つき */
  sameDrug: { t: Tablet; ex: Explained }[];
  master: Tablet[];
  /** この行で製品を選んだらどうなるか（札）。「別の薬から探す」の一覧に使う */
  explain: (t: Tablet) => Explained;
  /** 処方箋の薬品名（ルール外を選んだ記録に残す） */
  rxName: string;
  /** ルール外・採用中止・候補にとどめた製品を手で選んだときの記録（理由・変更者つき） */
  onOverrideRecord: (r: RuleOverrideRecord) => void;
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
  const [pending, setPending] = useState<{ t: Tablet; ex: Explained } | null>(null); // 札つきの製品を選ぶ前の、理由の入力
  const [reason, setReason] = useState("");
  const [overrideError, setOverrideError] = useState<string | null>(null);

  const unknown = isMakerUnknown(facility?.maker_state);
  const previous = previousAdopted(facility?.drug_key); // メーカー切替で採用をやめた製品（「以前の採用」の札）
  const adoptedKeys = new Set(sameDrug.map(({ t }) => t.product_key ?? t.brand_name));
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
  /** 札（ルール外・採用中止・候補にとどめた理由）のある製品は、理由と変更者を入れてから選ぶ */
  function pickLabelled(t: Tablet, ex: Explained) {
    // 理由と変更者が要るかは lib/pick.ts の needsOverrideRecord が決める（自動で選ばれる製品のほかは、別の薬も含めて要る）
    if (!needsOverrideRecord(ex.kind)) return selectTablet(t.id);
    setPending({ t, ex });
    setReason("");
    setOverrideError(null);
  }
  function confirmLabelled() {
    if (!pending) return;
    try {
      const rec = buildRuleOverrideRecord({ name_as_written: rxName, product: pending.t, rule: overrideRule(pending.ex), reason, changed_by: changedBy });
      onOverrideRecord(rec);
      setPending(null);
      selectTablet(pending.t.id);
    } catch (e) {
      setOverrideError(e instanceof Error ? e.message : String(e));
    }
  }

  const shownName = override ? override.candidate.brand_name : facility?.brand_name;
  const shownUnverified = !override && !!facility && facility.status !== "verified"; // 「未確認」の札は施設の採用品だけ
  const q = query.normalize("NFKC").trim().toLowerCase();
  // 施設のマスタ全体。採用中止（adopted:false）・ルール外・候補にとどめる製品には札をつける（explain が adopted も見る）
  const hits = (q ? master.filter((m) => `${m.brand_name}${m.generic_name}`.normalize("NFKC").toLowerCase().includes(q)) : master).map((m) => ({ m, ex: explain(m), adopted: m.adopted }));

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
            {sameDrug.map(({ t, ex }) => (
              <li key={t.id}>
                <button
                  type="button"
                  aria-pressed={t.id === facility?.id && !override}
                  onClick={() => (t.id === facility?.id ? selectTablet(t.id) : pickLabelled(t, ex))}
                  className={`w-full rounded-lg border px-2 py-2 text-left ${t.id === facility?.id && !override ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white"}`}
                >
                  <div className="flex flex-wrap items-center gap-1">
                    <b className="text-sm">{productLabel(t)}</b>
                    {t.status !== "verified" && <span className="rounded bg-amber-500 px-1 text-white">未確認</span>}
                    {isMakerUnknown(t.maker_state) && <span className="rounded bg-amber-500 px-1 text-white">メーカー未確定</span>}
                  </div>
                  {ex.reason && t.id !== facility?.id && <ReasonTag ex={ex} />}
                  <div className="font-mono text-slate-700">{imprintSummary(t)}</div>
                </button>
              </li>
            ))}
          </ul>
          {pending && <OverrideForm pending={pending} reason={reason} setReason={setReason} changedBy={changedBy} setChangedBy={setChangedBy} error={overrideError} onOk={confirmLabelled} onCancel={() => setPending(null)} />}
          {busy && <p className="text-slate-500">採用外の製品を読んでいます…</p>}
          {error && <p className="text-red-700">{error}</p>}
          {outside.length > 0 && <div className="font-semibold text-slate-600">採用外（同じ成分・規格・剤形の他社）<span className="font-normal text-slate-500">— 添付文書の値・未確認</span></div>}
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
                      <b className="text-sm">{productLabel(c)}</b>
                      {previous.has(c.product_key) && <span className="rounded bg-slate-500 px-1 text-white">以前の採用</span>}
                    </div>
                    <div className="font-mono text-slate-700">{imprintSummary(c)}</div>
                  </button>
                </li>
              );
            })}
          </ul>
          {picked && facility && (
            <div className="space-y-2 rounded-lg border border-blue-300 bg-white p-2">
              <div>
                選んだ製品：<b>{picked.brand_name}</b>
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
            {hits.map(({ m, ex }) => (
              <li key={m.id}>
                <button type="button" onClick={() => pickLabelled(m, ex)} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-left">
                  <span className="text-sm">{m.brand_name}</span>
                  {m.status !== "verified" && <span className="ml-1 rounded bg-amber-500 px-1 text-white">未確認</span>}
                  {ex.kind !== "auto" && <ReasonTag ex={ex} />}
                </button>
              </li>
            ))}
          </ul>
          {pending && <OverrideForm pending={pending} reason={reason} setReason={setReason} changedBy={changedBy} setChangedBy={setChangedBy} error={overrideError} onOk={confirmLabelled} onCancel={() => setPending(null)} />}
          <button type="button" onClick={() => setSearching(false)} className="w-full rounded-lg border border-slate-300 py-2">
            同じ薬の一覧に戻る
          </button>
        </div>
      )}
    </div>
  );
}

/** 一覧の 1 件の札：候補にとどめる理由（入れ替えない組・事前合意があれば選択可 など）、ルール外の理由、採用中止、置き換え、別の薬（読み取りの直し） */
function ReasonTag({ ex }: { ex: Explained }) {
  const label = ex.kind === "ruleOut" ? `ルール外：${ex.reason}` : ex.kind === "discontinued" ? ex.reason : ex.kind === "auto" ? ex.reason : ex.reason ?? "候補";
  if (!label) return null;
  const cls = ex.kind === "auto" ? "bg-sky-100 text-sky-900" : ex.kind === "candidate" ? "bg-amber-100 text-amber-900" : "bg-red-100 text-red-900";
  return <div className={`mt-0.5 rounded px-1 text-[11px] ${cls}`}>{label}</div>;
}

/** 札のある製品を選ぶ前に、理由と変更者を入れる（lib/matching.ts の buildRuleOverrideRecord で記録を作る。保存はまだしない） */
function OverrideForm({ pending, reason, setReason, changedBy, setChangedBy, error, onOk, onCancel }: {
  pending: { t: Tablet; ex: Explained };
  reason: string;
  setReason: (s: string) => void;
  changedBy: string;
  setChangedBy: (s: string) => void;
  error: string | null;
  onOk: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-red-300 bg-white p-2">
      <div>
        <b>{pending.t.brand_name}</b> を選ぶには理由と変更者が要ります
        <ReasonTag ex={pending.ex} />
      </div>
      <label className="block text-slate-600">
        理由（例：医師に確認済み）
        <input value={reason} onChange={(e) => setReason(e.target.value)} className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-base" />
      </label>
      <label className="block text-slate-600">
        変更者
        <input value={changedBy} onChange={(e) => setChangedBy(e.target.value)} placeholder="名前またはイニシャル" className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-base" />
      </label>
      {error && <p className="text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-300 px-3 py-2">やめる</button>
        <button type="button" disabled={!reason.trim() || !changedBy.trim()} onClick={onOk} className="flex-1 rounded-lg bg-red-700 py-2 font-bold text-white disabled:opacity-40">
          理由を記録して選ぶ
        </button>
      </div>
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

/** 札のある製品を手で選んだ記録（理由・変更者つき）。保存はまだしないので JSON の文字として確認係に渡す */
export function OverrideLog({ overrides }: { overrides: RuleOverrideRecord[] }) {
  if (!overrides.length) return null;
  return (
    <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm">
      <div className="font-semibold">決まりの外の製品を手で選んだ記録（{overrides.length} 件）</div>
      <p className="mt-1 text-xs text-red-900">保存はまだ作っていません。画面を閉じると消えます。文字をコピーして確認係に渡してください。</p>
      <textarea readOnly value={JSON.stringify(overrides, null, 2)} rows={Math.min(10, overrides.length * 8)} className="mt-2 w-full rounded border border-slate-300 bg-white p-2 font-mono text-[11px]" onFocus={(e) => e.currentTarget.select()} />
    </div>
  );
}
