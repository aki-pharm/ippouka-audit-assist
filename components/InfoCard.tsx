"use client";
import type { Tablet } from "@/lib/types";
import { TabletSvg, sizeText } from "./Tablet";

const FILL_LABEL = { cassette: "カセット（分包機）", manual: "手巻き" } as const;

export function InfoCard({ tablet, name, onClose }: { tablet: Tablet | undefined; name: string; onClose: () => void }) {
  const pmdaSearch = `https://www.pmda.go.jp/PmdaSearch/iyakuSearch/`;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-2 sm:items-center" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-lg font-bold leading-tight">{tablet?.brand_name ?? name}</h3>
          <button type="button" onClick={onClose} className="rounded-full px-2 text-2xl leading-none text-slate-500">×</button>
        </div>
        {!tablet ? (
          <p className="mt-3 text-sm text-amber-800">マスタに登録がありません。処方箋の表記：{name}</p>
        ) : (
          <>
            <div className="mt-3 flex items-center justify-around rounded-xl bg-slate-50 py-3">
              <div className="text-center text-xs text-slate-500">
                <TabletSvg tablet={tablet} face="front" />
                <div>表</div>
              </div>
              <div className="text-center text-xs text-slate-500">
                <TabletSvg tablet={tablet} face="back" />
                <div>裏</div>
              </div>
            </div>
            {tablet.status === "draft" && (
              <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
                このマスタ行は確認前（draft）です。表示は仮の値を含みます。
              </p>
            )}
            <dl className="mt-3 grid grid-cols-[6.5em_1fr] gap-y-1 text-sm">
              <dt className="text-slate-500">一般名</dt><dd>{tablet.generic_name}</dd>
              <dt className="text-slate-500">規格</dt><dd>{tablet.strength}</dd>
              <dt className="text-slate-500">メーカー</dt><dd>{tablet.maker ?? "未確認"}</dd>
              <dt className="text-slate-500">刻印（表）</dt><dd className="font-mono">{tablet.imprint_front}</dd>
              <dt className="text-slate-500">刻印（裏）</dt><dd className="font-mono">{tablet.imprint_back}</dd>
              {tablet.imprint_note && (<><dt className="text-slate-500">補足</dt><dd>{tablet.imprint_note}</dd></>)}
              <dt className="text-slate-500">色</dt><dd>{tablet.color}</dd>
              <dt className="text-slate-500">形</dt><dd>{shapeLabel(tablet.shape)}</dd>
              <dt className="text-slate-500">大きさ</dt><dd>{sizeText(tablet)}{tablet.thickness_mm != null ? `、厚さ ${tablet.thickness_mm}mm` : ""}</dd>
              <dt className="text-slate-500">一包化区分</dt><dd>{tablet.pack_rule === "include" ? "入れる" : `入れない（${tablet.pack_rule_reason ?? "施設ルール"}）`}</dd>
              <dt className="text-slate-500">分包方法</dt><dd>{tablet.fill_method ? FILL_LABEL[tablet.fill_method] : "未設定"}</dd>
              <dt className="text-slate-500">添付文書</dt><dd>{tablet.source_revision ? `改訂 ${tablet.source_revision}` : "改訂日 未確認"}</dd>
              <dt className="text-slate-500">マスタ確認</dt><dd>{tablet.verified_at ? `${tablet.verified_at}（${tablet.verified_by ?? ""}）` : "未確認"}</dd>
            </dl>
            <div className="mt-4 flex flex-col gap-2">
              {tablet.source_url ? (
                <a href={tablet.source_url} target="_blank" rel="noopener noreferrer" className="rounded-xl bg-blue-700 px-4 py-3 text-center font-bold text-white">
                  添付文書（PDF）を開く
                </a>
              ) : (
                <a href={pmdaSearch} target="_blank" rel="noopener noreferrer" className="rounded-xl bg-blue-700 px-4 py-3 text-center font-bold text-white">
                  PMDAで添付文書を検索
                </a>
              )}
              <p className="text-center text-xs text-slate-500">用法用量の確認は添付文書（情報源）で行ってください。</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function shapeLabel(s: Tablet["shape"]): string {
  return s === "round" ? "円形" : s === "oval" ? "楕円形" : s === "oblong" ? "長円形" : s === "other" ? "その他" : "未確認";
}
