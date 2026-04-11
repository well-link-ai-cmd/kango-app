import { NextResponse } from "next/server";
import { getServerSupabase, getAuthUser } from "@/lib/supabase-server";
import { hashPassword } from "@/lib/password";

/** 初期セットアップ: 最初のユーザーを管理者として登録 + パスワード設定 */
export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const supabase = await getServerSupabase();

  // 既にユーザーが存在する場合はセットアップ不可
  const { data: existingUsers } = await supabase
    .from("allowed_users")
    .select("id")
    .limit(1);

  if (existingUsers && existingUsers.length > 0) {
    return NextResponse.json(
      { error: "セットアップは既に完了しています" },
      { status: 400 }
    );
  }

  const { password } = await request.json();
  if (!password || password.length < 4) {
    return NextResponse.json(
      { error: "パスワードは4文字以上で設定してください" },
      { status: 400 }
    );
  }

  // 最初のユーザーを管理者として登録
  const { error: userError } = await supabase.from("allowed_users").insert({
    email: user.email,
    role: "admin",
    display_name: user.user_metadata?.full_name || user.email,
  });

  if (userError) {
    return NextResponse.json(
      { error: "ユーザー登録に失敗しました: " + userError.message },
      { status: 500 }
    );
  }

  // パスワード設定
  const hashed = hashPassword(password);
  const { error: settingError } = await supabase.from("app_settings").upsert({
    key: "org_password",
    value: hashed,
    updated_at: new Date().toISOString(),
  });

  if (settingError) {
    return NextResponse.json(
      { error: "パスワード設定に失敗しました: " + settingError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ status: "ok", role: "admin" });
}
