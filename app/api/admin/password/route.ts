import { NextResponse } from "next/server";
import { getServerSupabase, getAuthUser } from "@/lib/supabase-server";
import { hashPassword, verifyPassword } from "@/lib/password";

/** パスワード変更（管理者のみ） */
export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const supabase = await getServerSupabase();
  const { data: adminCheck } = await supabase
    .from("allowed_users")
    .select("role")
    .eq("email", user.email!)
    .single();

  if (!adminCheck || adminCheck.role !== "admin") {
    return NextResponse.json(
      { error: "管理者権限が必要です" },
      { status: 403 }
    );
  }

  const { currentPassword, newPassword } = await request.json();
  if (!newPassword || newPassword.length < 4) {
    return NextResponse.json(
      { error: "新しいパスワードは4文字以上で設定してください" },
      { status: 400 }
    );
  }

  // 現在のパスワードを検証
  const { data: settings } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "org_password")
    .single();

  if (settings && currentPassword) {
    if (!verifyPassword(currentPassword, settings.value)) {
      return NextResponse.json(
        { error: "現在のパスワードが正しくありません" },
        { status: 403 }
      );
    }
  }

  // 新しいパスワードを保存
  const hashed = hashPassword(newPassword);
  const { error } = await supabase.from("app_settings").upsert({
    key: "org_password",
    value: hashed,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ status: "ok" });
}
