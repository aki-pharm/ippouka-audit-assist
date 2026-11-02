import { NextResponse } from "next/server";
import { tokenFor } from "@/lib/authToken";

export async function POST(request: Request) {
  const pass = process.env.APP_PASSCODE;
  if (!pass) return NextResponse.json({ ok: true });
  const body = (await request.json().catch(() => ({}))) as { passcode?: string };
  if (!body.passcode || body.passcode !== pass) {
    await new Promise((r) => setTimeout(r, 800)); // 総当たりをゆっくりにする
    return NextResponse.json({ error: "パスコードが違います" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set("ippouka_auth", tokenFor(pass), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
  return res;
}
