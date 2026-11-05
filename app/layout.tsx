import type { Metadata, Viewport } from "next";
import "@fontsource/noto-sans-jp/400.css";
import "@fontsource/noto-sans-jp/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "一包化監査アシスト",
  description: "一包化の1包目監査を支える、薬剤師のためのイメージ図ツール（判断は薬剤師が行います）",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-slate-100 text-slate-900">
        <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 px-4 py-2 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-baseline justify-between">
            <h1 className="text-base font-bold">一包化監査アシスト</h1>
            <span className="text-xs text-slate-500">判断は薬剤師が行います</span>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 px-4 py-1.5 text-center text-[11px] text-slate-500 backdrop-blur">
          本ツールは監査を支援する情報表示です。判断は薬剤師が行います。
        </footer>
      </body>
    </html>
  );
}
