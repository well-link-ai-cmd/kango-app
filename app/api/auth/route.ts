import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { password } = await req.json();
  const correctPassword = process.env.APP_PASSWORD;

  if (!correctPassword) {
    // パスワード未設定の場合は認証スキップ
    return NextResponse.json({ ok: true });
  }

  if (password === correctPassword) {
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: "パスワードが違います" }, { status: 401 });
}
