"use client";
import { sortEntries, type Bag, type BagOrder } from "@/lib/packing";
import { TIMING_LABEL } from "@/lib/types";
import { TabletSvg, imprintLayout, sizeText } from "./Tablet";
import { sourceLink } from "@/lib/master";
import { isUnconfirmed, makerLabel, type DrawnTablet } from "@/lib/makers";

export function BagView({
  bag,
  onTap,
  order = "rx",
}: {
  bag: Bag;
  onTap: (t: DrawnTablet | undefined, name: string) => void;
  order?: BagOrder;
}) {
  const entries = sortEntries(bag.entries, order);
  return (
    <section className="rounded-2xl border border-slate-300 bg-white shadow-sm">
      <header className="flex items-baseline justify-between rounded-t-2xl bg-slate-800 px-4 py-2 text-white">
        <h3 className="text-lg font-bold">{TIMING_LABEL[bag.timing]}食後</h3>
        <span className="text-sm">
          {bag.total === 0 ? "なし" : `${bag.total} 個`}
        </span>
      </header>
      {bag.groups.length > 0 && (
        <div className="mx-3 mt-3 rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {bag.groups.map((g) => (
            <div key={g.label}>
              ⚠ 見分け注意 <GroupBadge label={g.label} />：{g.note}
            </div>
          ))}
        </div>
      )}
      <ul className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 md:grid-cols-4">
        {entries.length === 0 && <li className="col-span-full py-6 text-center text-slate-400">この袋には入りません</li>}
        {entries.map((e) => {
          if (e.pending) {
            // 今のメーカーが決まっていない薬は描かない（複数のメーカーを描かない）。表に戻って選ぶ
            return (
              <li key={e.row.key} className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-amber-400 bg-amber-50 p-2 text-center text-xs text-amber-900">
                <span className="self-end text-base font-bold text-slate-700">×{e.count}</span>
                <span className="rounded bg-amber-500 px-1 font-bold text-white">メーカー未確定</span>
                <span className="mt-1 line-clamp-2 font-semibold text-slate-800">{shortName(e.row.name_as_written)}</span>
                <span className="mt-1">「確認」の表で今のメーカーを選ぶと描きます</span>
              </li>
            );
          }
          const link = sourceLink(e.tablet);
          const unconfirmed = isUnconfirmed(e.tablet);
          const shown = Math.min(e.count, 3);
          const lay = imprintLayout(e.tablet);
          return (
            <li key={e.row.key} className="flex flex-col rounded-xl border border-slate-200 bg-slate-50 p-2">
              <button
                type="button"
                onClick={() => onTap(e.tablet, e.row.name_as_written)}
                className="flex flex-1 flex-col items-center text-left active:bg-slate-100"
              >
                <div className="relative flex min-h-24 w-full flex-col items-center justify-center pt-5">
                  {e.group && (
                    <span className="absolute left-0 top-0">
                      <GroupBadge label={e.group} />
                    </span>
                  )}
                  {unconfirmed && <span className="absolute left-7 top-0 rounded bg-amber-500 px-1 text-xs font-bold text-white">未確認</span>}
                  <span className="absolute right-0 top-0 text-base font-bold text-slate-700">×{e.count}</span>
                  {/* 同じ錠剤を横に並べる（3個まで）。刻印は錠剤に収まるときだけ中に描き、収まらなければ下に1回だけ出す */}
                  <div className="flex flex-wrap items-center justify-center gap-1">
                    {Array.from({ length: shown }).map((_, i) =>
                      e.tablet?.dosage_form === "capsule" ? (
                        <div key={i} className="flex h-10 items-center justify-center rounded-full border border-dashed border-slate-400 px-3 text-xs text-slate-500">
                          カプセル
                        </div>
                      ) : (
                        <TabletSvg key={i} tablet={e.tablet} highlight={!!e.group} caption={false} />
                      ),
                    )}
                    {e.count > shown && <span className="text-xs text-slate-500">…</span>}
                  </div>
                  {lay.label && !lay.inside && e.tablet?.dosage_form !== "capsule" && (
                    <div
                      className={`mt-0.5 max-w-full break-all text-center font-mono text-xs leading-tight ${lay.unverified ? "italic text-slate-400" : "text-slate-800"}`}
                      title={lay.label}
                    >
                      {lay.label}
                    </div>
                  )}
                  {/* 裏の刻印はその下に小さく（「なし」「未確認」は出さない） */}
                  {e.tablet && e.tablet.dosage_form !== "capsule" && e.tablet.imprint_back !== "なし" && e.tablet.imprint_back !== "未確認" && (
                    <div className="mt-0.5 max-w-full break-all text-center font-mono text-[11px] leading-tight text-slate-500" title={`裏：${e.tablet.imprint_back}`}>
                      裏 {e.tablet.imprint_back}
                    </div>
                  )}
                </div>
                <div className="flex min-h-[3rem] w-full flex-col justify-start text-center text-xs leading-tight">
                  <div className="line-clamp-2 font-semibold text-slate-800">{shortName(e.tablet?.brand_name ?? e.row.name_as_written)}</div>
                  {e.tablet && <div className="text-slate-500">{makerLabel(e.tablet)}</div>}
                  <div className="text-slate-500">{sizeText(e.tablet)}</div>
                </div>
              </button>
              <a
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className={`mt-1 block rounded-lg py-1 text-center text-xs ${unconfirmed ? "bg-blue-700 font-bold text-white" : "border border-blue-200 bg-white text-blue-800"}`}
              >
                {link.direct ? (unconfirmed ? "📄 添付文書で確かめる" : "📄 添付文書") : "🔍 PMDAで検索"}
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function GroupBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-white">
      {label}
    </span>
  );
}

function shortName(name: string): string {
  return name.replace(/[「『][^」』]*[」』]/g, "").slice(0, 20);
}
