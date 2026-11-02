"use client";
import { useState } from "react";

export default function LoginPage() {
  const [pass, setPass] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode: pass }) });
    setBusy(false);
    if (res.ok) {
      const next = new URLSearchParams(window.location.search).get("next") ?? "/";
      window.location.href = next.startsWith("/") ? next : "/";
    } else {
      setErr("パスコードが違います");
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto mt-16 max-w-sm space-y-3 px-4">
      <h2 className="text-lg font-bold">パスコード</h2>
      <p className="text-sm text-slate-600">このURLは試作中のため、共通パスコードで保護しています。</p>
      <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoFocus className="w-full rounded-xl border border-slate-300 px-3 py-3 text-lg" />
      {err && <p className="text-sm text-red-700">{err}</p>}
      <button type="submit" disabled={busy || !pass} className="w-full rounded-xl bg-slate-800 px-4 py-3 font-bold text-white disabled:opacity-50">入る</button>
    </form>
  );
}
