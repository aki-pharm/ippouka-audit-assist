"use client";
import { useState } from "react";
import { Flow } from "./Flow";

/** ホーム画面：使う機能を選ぶ。今使えるのは一包化監査だけ（持参薬鑑別・ピッキング補助は準備中） */
export function Home() {
  const [app, setApp] = useState<"home" | "audit">("home");
  if (app === "audit") {
    return (
      <div>
        <div className="mx-auto max-w-3xl px-4 pt-2">
          <button type="button" onClick={() => setApp("home")} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700">
            ← ホーム
          </button>
        </div>
        <Flow />
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-3xl space-y-3 px-4 py-4">
      <h1 className="text-xl font-bold">何をしますか</h1>
      <button type="button" onClick={() => setApp("audit")} className="block w-full rounded-2xl border-2 border-emerald-700 bg-white p-4 text-left shadow-sm active:bg-emerald-50">
        <div className="text-lg font-bold text-emerald-800">一包化監査</div>
        <div className="mt-1 text-sm text-slate-600">処方箋を撮って、朝・昼・夕の袋に入る錠剤の図を出す</div>
      </button>
      <ComingSoon title="持参薬鑑別" text="お薬手帳・薬情の読み取り、刻印検索" />
      <ComingSoon title="ピッキング補助" text="複数の処方箋の薬をまとめて取る" />
    </div>
  );
}

function ComingSoon({ title, text }: { title: string; text: string }) {
  return (
    <div aria-disabled="true" className="rounded-2xl border border-slate-200 bg-slate-100 p-4 text-slate-500">
      <div className="flex items-center gap-2">
        <span className="text-lg font-bold">{title}</span>
        <span className="rounded bg-slate-400 px-1.5 text-xs font-bold text-white">準備中</span>
      </div>
      <div className="mt-1 text-sm">{text}</div>
    </div>
  );
}
