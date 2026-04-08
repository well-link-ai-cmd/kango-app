import { NextResponse } from "next/server";

// このルートは以前の簡易パスワード認証用でした。
// Supabase Auth に移行したため、認証はクライアント側で直接行います。
// 後方互換のため404ではなくメッセージを返します。
export async function POST() {
  return NextResponse.json({
    ok: false,
    error: "この認証方式は廃止されました。メールアドレスでログインしてください。",
  }, { status: 410 });
}
