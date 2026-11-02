import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { tokenFor } from "@/lib/authToken";

/**
 * 公開URLの保護（共通パスコード）。目的はAPIクレジットを他人に使われないこと。
 * APP_PASSCODE が未設定なら保護しない（ローカル開発用）。
 */
export function proxy(request: NextRequest) {
  const pass = process.env.APP_PASSCODE;
  if (!pass) return NextResponse.next();
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/login") || pathname.startsWith("/api/login") || pathname.startsWith("/samples/")) {
    return NextResponse.next();
  }
  const expected = tokenFor(pass);
  const got = request.cookies.get("ippouka_auth")?.value;
  if (got && got === expected) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "パスコードが必要です" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}


export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
