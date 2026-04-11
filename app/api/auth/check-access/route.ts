import { NextResponse } from "next/server";
import { getServerSupabase, getAuthUser } from "@/lib/supabase-server";
import { verifyPassword } from "@/lib/password";

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const supabase = await getServerSupabase();
  const email = user.email;

  // allowed_users テーブルの存在確認
  const { data: allowedUsers, error: tableError } = await supabase
    .from("allowed_users")
    .select("*");

  if (tableError) {
    // テーブルが存在しない場合 → まだマイグレーション未実行（全員アクセス可能）
    return NextResponse.json({ status: "no_table", allowed: true });
  }

  // テーブルは存在するが、ユーザーが0人 → 初期セットアップが必要
  if (!allowedUsers || allowedUsers.length === 0) {
    return NextResponse.json({ status: "needs_setup" });
  }

  // メールアドレスが許可リストにあるかチェック
  const allowedUser = allowedUsers.find(
    (u: { email: string }) => u.email.toLowerCase() === email?.toLowerCase()
  );
  if (!allowedUser) {
    return NextResponse.json({ status: "not_allowed", allowed: false });
  }

  // パスワード検証
  const { password } = await request.json();
  const { data: settings } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "org_password")
    .single();

  if (!settings) {
    // パスワード未設定 → 許可リストにあればOK
    return NextResponse.json({
      status: "ok",
      allowed: true,
      role: allowedUser.role,
    });
  }

  if (!password) {
    return NextResponse.json({ status: "needs_password" });
  }

  if (!verifyPassword(password, settings.value)) {
    return NextResponse.json({ status: "wrong_password" }, { status: 403 });
  }

  return NextResponse.json({
    status: "ok",
    allowed: true,
    role: allowedUser.role,
  });
}
