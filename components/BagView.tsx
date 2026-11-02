"use client";
import type { Bag } from "@/lib/packing";
import { TIMING_LABEL, type Tablet } from "@/lib/types";
import { TabletSvg, sizeText } from "./Tablet";
import { sourceLink } from "@/lib/master";

export function BagView({ bag, onTap }: { bag: Bag; onTap: (t: Tablet | undefined, name: string) => void }) {
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
      <ul className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3">
        {bag.entries.length === 0 && <li className="col-span-full py-6 text-center text-slate-400">この袋には入りません</li>}
        {bag.entries.map((e) =>
          Array.from({ length: e.count }).map((_, i) => (
            <li key={`${e.row.key}-${i}`}>
              <button
                type="button"
                onClick={() => onTap(e.tablet, e.row.name_as_written)}
                className="flex w-full flex-col items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-2 text-left active:bg-slate-100"
              >
                <div className="relative">
                  {e.group && (
                    <span className="absolute -left-2 -top-2">
                      <GroupBadge label={e.group} />
                    </span>
                  )}
                  {e.tablet?.dosage_form === "capsule" ? (
                    <div className="flex h-14 items-center justify-center rounded-full border border-dashed border-slate-400 px-3 text-xs text-slate-500">
                      カプセル
                    </div>
                  ) : (
                    <TabletSvg tablet={e.tablet} highlight={!!e.group} />
                  )}
                </div>
                <div className="w-full text-center text-xs leading-tight">
                  <div className="font-semibold text-slate-800">{shortName(e.tablet?.brand_name ?? e.row.name_as_written)}</div>
                  <div className="text-slate-500">{sizeText(e.tablet)}</div>
                  {e.count > 1 && <div className="text-slate-400">{i + 1}/{e.count}</div>}
                </div>
              </button>
              {i === 0 && (
                <a
                  href={sourceLink(e.tablet).href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 block rounded-lg border border-blue-200 bg-white py-1 text-center text-xs text-blue-800"
                >
                  {sourceLink(e.tablet).direct ? "📄 添付文書を開く" : "🔍 PMDAで検索"}
                </a>
              )}
            </li>
          )),
        )}
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
  return name.replace(/[「『][^」』]*[」』]/g, "").slice(0, 16);
}
