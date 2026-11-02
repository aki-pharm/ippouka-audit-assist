"use client";
import { useMemo, useRef, useState } from "react";
import { loadMaster, findTablet } from "@/lib/master";
import { buildBags, checkRow, recomputeDefault, toRows } from "@/lib/packing";
import { fileToResizedBase64 } from "@/lib/image";
import { TIMINGS, TIMING_LABEL, type RxReadResult, type RxRow, type Tablet } from "@/lib/types";
import { BagView } from "./BagView";
import { InfoCard } from "./InfoCard";

type Step = "capture" | "review" | "select" | "bags" | "compare";
type Img = { base64: string; mediaType: "image/jpeg"; url: string };

const SAMPLES = [
  { id: "a", label: "サンプルA（朝・昼・夕）", files: ["/samples/rx-a-1.png", "/samples/rx-a-2.png"], expected: "/samples/rx-a.expected.json" },
  { id: "b", label: "サンプルB（朝・夕、一般名処方あり）", files: ["/samples/rx-b-1.png"], expected: "/samples/rx-b.expected.json" },
  { id: "c", label: "サンプルC（朝・夕、下剤も一包化）", files: ["/samples/rx-c-1.png", "/samples/rx-c-2.png"], expected: "/samples/rx-c.expected.json" },
];

export function Flow() {
  const [step, setStep] = useState<Step>("capture");
  const [images, setImages] = useState<Img[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rx, setRx] = useState<RxReadResult | null>(null);
  const [rows, setRows] = useState<RxRow[]>([]);
  const [info, setInfo] = useState<{ tablet: Tablet | undefined; name: string } | null>(null);
  const [packPhoto, setPackPhoto] = useState<string | null>(null);
  const [sampleExpected, setSampleExpected] = useState<string | null>(null);
  const [noApiKey, setNoApiKey] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const packRef = useRef<HTMLInputElement>(null);
  const master = useMemo(() => loadMaster(), []);
  const bags = useMemo(() => buildBags(rows), [rows]);

  async function addFiles(files: FileList | null) {
    if (!files) return;
    const next: Img[] = [];
    for (const f of Array.from(files)) {
      const r = await fileToResizedBase64(f);
      next.push({ ...r, url: URL.createObjectURL(f) });
    }
    setImages((prev) => [...prev, ...next]);
  }

  async function loadSample(files: string[], expected: string) {
    setBusy(true);
    setError(null);
    setSampleExpected(expected);
    try {
      const next: Img[] = [];
      for (const path of files) {
        const blob = await (await fetch(path)).blob();
        const r = await fileToResizedBase64(blob);
        next.push({ ...r, url: path });
      }
      setImages(next);
    } catch (e) {
      setError(`サンプルを読み込めませんでした：${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function read() {
    if (images.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/read-rx", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ images: images.map((i) => ({ base64: i.base64, mediaType: i.mediaType })) }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.code === "no_api_key") setNoApiKey(true);
        throw new Error(json.error ?? `読み取りに失敗しました（${res.status}）`);
      }
      applyResult(json.result as RxReadResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** 開発用：APIキーがない環境で、サンプルの期待結果をそのまま使う（本番のデモでは使わない） */
  async function useExpected() {
    if (!sampleExpected) return;
    const result = (await (await fetch(sampleExpected)).json()) as RxReadResult;
    applyResult(result);
  }

  function applyResult(result: RxReadResult) {
    setError(null);
    setRx(result);
    setRows(toRows(result));
    setStep("review");
  }

  function updateRow(key: string, patch: Partial<RxRow>, recompute = false) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        const next = { ...r, ...patch };
        return recompute && rx ? recomputeDefault(next, rx) : next;
      }),
    );
  }

  async function onPackPhoto(files: FileList | null) {
    if (!files || !files[0]) return;
    setPackPhoto(URL.createObjectURL(files[0]));
  }

  const excluded = rows.filter((r) => !r.include);

  return (
    <div className="mx-auto max-w-3xl px-4 pb-24">
      <Stepper step={step} />
      {error && <p className="my-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      {step === "capture" && (
        <section className="space-y-4">
          <div className="rounded-2xl border border-slate-300 bg-white p-4">
            <h2 className="text-lg font-bold">1. 処方箋の薬剤欄を撮る</h2>
            <ul className="mt-2 list-disc pl-5 text-sm text-slate-700">
              <li><b>薬剤情報の欄だけ</b>を写してください。患者情報の欄は入れないでください。</li>
              <li>文字が横にならない向きで、真上から。2ページ目があれば「もう1枚」。</li>
              <li>画像はサーバに保存しません。読み取りにだけ使います。</li>
            </ul>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => fileRef.current?.click()} className="flex-1 rounded-xl bg-blue-700 px-4 py-4 text-lg font-bold text-white">
                {images.length ? "もう1枚撮る" : "カメラで撮る"}
              </button>
            </div>
            {images.length > 0 && (
              <div className="mt-3 flex gap-2 overflow-x-auto">
                {images.map((img, i) => (
                  <div key={i} className="relative shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt={`処方箋 ${i + 1}枚目`} className="h-28 rounded-lg border object-cover" />
                    <button type="button" onClick={() => setImages(images.filter((_, j) => j !== i))} className="absolute -right-1 -top-1 rounded-full bg-slate-700 px-1.5 text-xs text-white">×</button>
                  </div>
                ))}
              </div>
            )}
            {images.length > 0 && (
              <button type="button" disabled={busy} onClick={read} className="mt-3 w-full rounded-xl bg-emerald-700 px-4 py-4 text-lg font-bold text-white disabled:opacity-50">
                {busy ? "読み取り中…" : `読み取る（${images.length}枚）`}
              </button>
            )}
            {noApiKey && sampleExpected && (
              <button type="button" onClick={useExpected} className="mt-2 w-full rounded-xl border border-dashed border-slate-400 px-4 py-2 text-sm text-slate-600">
                開発用：このサンプルの読み取り済み結果を使う（APIキーなし）
              </button>
            )}
          </div>
          <details className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
            <summary className="cursor-pointer font-semibold">サンプルで試す（架空の処方箋）</summary>
            <div className="mt-2 flex flex-col gap-2">
              {SAMPLES.map((s) => (
                <button key={s.id} type="button" disabled={busy} onClick={() => loadSample(s.files, s.expected)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm">
                  {s.label}
                </button>
              ))}
            </div>
          </details>
        </section>
      )}

      {step === "review" && rx && (
        <section className="space-y-3">
          <h2 className="text-lg font-bold">2. 読み取り結果を確認する</h2>
          <p className="text-sm text-slate-600">読み取りは下書きです。間違いがあれば直してください。黄色の行は確認が必要です。</p>
          {rx.notes && <p className="rounded bg-slate-100 px-3 py-2 text-sm">読み取りメモ：{rx.notes}</p>}
          <div className="text-sm">
            一包化の指示：{rx.all_one_dose ? "あり（All One Dose）" : "なし"}
            {rx.include_all_note && <>／ 追記：「{rx.include_all_note}」</>}
          </div>
          <ul className="space-y-2">
            {rows.map((r) => {
              const flags = checkRow(r);
              const warn = flags.some((f) => f.level === "warn");
              const t = findTablet(r.tablet_id);
              return (
                <li key={r.key} className={`rounded-xl border p-3 ${warn ? "border-amber-400 bg-amber-50" : "border-slate-200 bg-white"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs text-slate-500">Rp {r.rp}{r.manual_fill_mark && <span className="ml-1 rounded border border-blue-500 px-1 text-blue-700">コ 手巻き</span>}</div>
                      <div className="font-semibold">{r.name_as_written}</div>
                      {r.name_note && <div className="text-xs text-slate-500">（{r.name_note}）</div>}
                      <div className="text-xs text-slate-600">{r.raw_usage_text}{r.days != null && ` ／ ${r.days}日分`}</div>
                    </div>
                    <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-xs">{r.dosage_form === "tablet" ? "錠" : r.dosage_form === "capsule" ? "Cap" : "対象外"}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {TIMINGS.map((tm) => (
                      <label key={tm} className="text-xs text-slate-600">
                        {TIMING_LABEL[tm]}
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={r.per_timing[tm]}
                          onChange={(e) => updateRow(r.key, { per_timing: { ...r.per_timing, [tm]: Math.max(0, Number(e.target.value) || 0) } })}
                          className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-base"
                        />
                      </label>
                    ))}
                  </div>
                  <label className="mt-2 block text-xs text-slate-600">
                    マスタの対応品
                    <select
                      value={r.tablet_id ?? ""}
                      onChange={(e) => updateRow(r.key, { tablet_id: e.target.value || null }, true)}
                      className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-base"
                    >
                      <option value="">（該当なし・未選択）</option>
                      {(r.candidates.length ? r.candidates.map((id) => findTablet(id)!).filter(Boolean) : master).map((m) => (
                        <option key={m.id} value={m.id}>{m.brand_name}</option>
                      ))}
                      {r.candidates.length > 0 && <option disabled>──── すべて ────</option>}
                      {r.candidates.length > 0 && master.filter((m) => !r.candidates.includes(m.id)).map((m) => (
                        <option key={m.id} value={m.id}>{m.brand_name}</option>
                      ))}
                    </select>
                  </label>
                  {t && t.brand_name !== r.name_as_written && (
                    <div className="mt-1 text-xs text-blue-800">処方箋：{r.name_as_written} → 採用品：{t.brand_name}</div>
                  )}
                  {flags.map((f, i) => (
                    <div key={i} className={`mt-1 text-xs ${f.level === "warn" ? "text-amber-900" : "text-slate-500"}`}>・{f.message}</div>
                  ))}
                </li>
              );
            })}
          </ul>
          <div className="flex gap-2">
            <button type="button" onClick={() => setStep("capture")} className="rounded-xl border border-slate-300 px-4 py-3">戻る</button>
            <button type="button" onClick={() => setStep("select")} className="flex-1 rounded-xl bg-emerald-700 px-4 py-3 text-lg font-bold text-white">この内容で進む</button>
          </div>
        </section>
      )}

      {step === "select" && (
        <section className="space-y-3">
          <h2 className="text-lg font-bold">3. 一包化に入れる／入れないを選ぶ</h2>
          <p className="text-sm text-slate-600">初期値は処方箋の指示と施設ルールから決めています。変えた行は色が付きます。</p>
          <ul className="space-y-2">
            {rows.map((r) => {
              const changed = r.include !== r.include_default;
              return (
                <li key={r.key} className={`flex items-center justify-between gap-3 rounded-xl border p-3 ${changed ? "border-violet-500 bg-violet-50" : "border-slate-200 bg-white"}`}>
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{findTablet(r.tablet_id)?.brand_name ?? r.name_as_written}</div>
                    <div className="text-xs text-slate-500">{r.include_reason}{changed && <span className="ml-1 rounded bg-violet-600 px-1 text-white">変更</span>}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => updateRow(r.key, { include: !r.include })}
                    className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${r.include ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-700"}`}
                  >
                    {r.include ? "入れる" : "入れない"}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex gap-2">
            <button type="button" onClick={() => setStep("review")} className="rounded-xl border border-slate-300 px-4 py-3">戻る</button>
            <button type="button" onClick={() => setStep("bags")} className="flex-1 rounded-xl bg-emerald-700 px-4 py-3 text-lg font-bold text-white">イメージ図を見る</button>
          </div>
        </section>
      )}

      {step === "bags" && (
        <section className="space-y-3">
          <h2 className="text-lg font-bold">4. 出来上がりイメージ図</h2>
          <p className="text-sm text-slate-600">処方箋の記載順に並べています。錠剤をタップすると登録情報と添付文書を開けます。</p>
          <div className="space-y-3">
            {bags.map((b) => <BagView key={b.timing} bag={b} onTap={(t, name) => setInfo({ tablet: t, name })} />)}
          </div>
          {excluded.length > 0 && (
            <div className="rounded-xl border border-slate-300 bg-slate-50 p-3 text-sm">
              <div className="font-semibold">別包・対象外（袋には入りません）</div>
              <ul className="mt-1 list-disc pl-5 text-slate-700">
                {excluded.map((r) => <li key={r.key}>{findTablet(r.tablet_id)?.brand_name ?? r.name_as_written}（{r.include_reason}）</li>)}
              </ul>
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={() => setStep("select")} className="rounded-xl border border-slate-300 px-4 py-3">戻る</button>
            <button type="button" onClick={() => setStep("compare")} className="flex-1 rounded-xl bg-blue-700 px-4 py-3 text-lg font-bold text-white">1包目と見比べる（任意）</button>
          </div>
        </section>
      )}

      {step === "compare" && (
        <section className="space-y-3">
          <h2 className="text-lg font-bold">5. 1包目と見比べる</h2>
          <p className="text-sm text-slate-600">錠剤を重ねず、無地の背景で、反射に注意して撮ってください。画像処理はしません。見比べる場を用意するだけです。</p>
          <input ref={packRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onPackPhoto(e.target.files)} />
          <button type="button" onClick={() => packRef.current?.click()} className="w-full rounded-xl bg-blue-700 px-4 py-4 text-lg font-bold text-white">1包目を撮る</button>
          {packPhoto && (
            <div className="space-y-3">
              {bags.filter((b) => b.total > 0).map((b) => <BagView key={b.timing} bag={b} onTap={(t, name) => setInfo({ tablet: t, name })} />)}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={packPhoto} alt="1包目の写真" className="w-full rounded-2xl border" />
            </div>
          )}
          <button type="button" onClick={() => setStep("bags")} className="rounded-xl border border-slate-300 px-4 py-3">イメージ図に戻る</button>
        </section>
      )}

      {info && <InfoCard tablet={info.tablet} name={info.name} onClose={() => setInfo(null)} />}
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  const steps: [Step, string][] = [["capture", "撮る"], ["review", "確認"], ["select", "選ぶ"], ["bags", "図"], ["compare", "見比べ"]];
  const idx = steps.findIndex(([s]) => s === step);
  return (
    <ol className="my-3 flex items-center gap-1 text-xs">
      {steps.map(([s, label], i) => (
        <li key={s} className={`flex-1 rounded-full px-2 py-1 text-center ${i === idx ? "bg-slate-800 text-white" : i < idx ? "bg-slate-300" : "bg-slate-100 text-slate-400"}`}>{label}</li>
      ))}
    </ol>
  );
}
