import { NextResponse } from "next/server";
import { getServerSupabase, getAuthUser } from "@/lib/supabase-server";

/** 管理者権限チェック */
async function checkAdmin() {
  const user = await getAuthUser();
  if (!user) return { error: "認証が必要です", status: 401 };

  const supabase = await getServerSupabase();
  const { data } = await supabase
    .from("allowed_users")
    .select("role")
    .eq("email", user.email!)
    .single();

  if (!data || data.role !== "admin") {
    return { error: "管理者権限が必要です", status: 403 };
  }

  return { user, supabase };
}

/** 許可ユーザー一覧取得 */
export async function GET() {
  const result = await checkAdmin();
  if ("error" in result) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status }
    );
  }

  const { data, error } = await result.supabase
    .from("allowed_users")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ users: data });
}

/** 許可ユーザー追加 */
export async function POST(request: Request) {
  const result = await checkAdmin();
  if ("error" in result) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status }
    );
  }

  const { email, role = "user", display_name } = await request.json();
  if (!email) {
    return NextResponse.json(
      { error: "メールアドレスを入力してください" },
      { status: 400 }
    );
  }

  const { data, error } = await result.supabase
    .from("allowed_users")
    .insert({ email: email.toLowerCase(), role, display_name })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "このメールアドレスは既に登録されています" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ user: data });
}

/** 許可ユーザー削除 */
export async function DELETE(request: Request) {
  const result = await checkAdmin();
  if ("error" in result) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status }
    );
  }

  const { id } = await request.json();
  if (!id) {
    return NextResponse.json(
      { error: "ユーザーIDを指定してください" },
      { status: 400 }
    );
  }

  // 自分自身を削除しようとした場合のチェック
  const { data: targetUser } = await result.supabase
    .from("allowed_users")
    .select("email")
    .eq("id", id)
    .single();

  if (targetUser?.email === result.user.email) {
    return NextResponse.json(
      { error: "自分自身を削除することはできません" },
      { status: 400 }
    );
  }

  const { error } = await result.supabase
    .from("allowed_users")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ status: "ok" });
}
