import { NextResponse } from "next/server";
import { getServerSupabase, getAuthUser } from "@/lib/supabase-server";

const CATEGORY_LABELS: Record<string, string> = {
  bug: "不具合の報告",
  request: "機能の要望",
  question: "使い方の質問",
  other: "その他",
};

/**
 * 問い合わせの通知メールを送る（GAS 経由）。
 * - 認証済みユーザーのみ。送信者宛先はそのユーザーのメール。
 * - CONTACT_GAS_URL / CONTACT_GAS_TOKEN が未設定なら何もせず成功扱い（無影響）。
 * - メール送信の成否は本処理（フォームのDB保存）を妨げない（呼び出し側は失敗を無視）。
 */
export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = process.env.CONTACT_GAS_URL;
  const token = process.env.CONTACT_GAS_TOKEN;
  // 未設定ならメール送信はスキップ（DB保存だけで運用）
  if (!url || !token) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  let category = "other";
  let body = "";
  try {
    const json = await req.json();
    category = typeof json.category === "string" ? json.category : "other";
    body = typeof json.body === "string" ? json.body : "";
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  if (!body.trim()) {
    return NextResponse.json({ ok: false, error: "empty_body" }, { status: 400 });
  }

  // 事業所名はベストエフォートで取得（RLSにより自分の所属のみ）
  let orgName: string | undefined;
  try {
    const supabase = await getServerSupabase();
    const { data: m } = await supabase
      .from("memberships")
      .select("organizations(name)")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    const org = (m as { organizations?: { name?: string } } | null)?.organizations;
    orgName = org?.name;
  } catch {
    // 名前が取れなくても通知は送る
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        category,
        categoryLabel: CATEGORY_LABELS[category] ?? category,
        body,
        replyTo: user.email ?? "",
        orgName,
      }),
    });
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `gas_${res.status}` }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("contact-notify error:", e);
    return NextResponse.json({ ok: false, error: "send_failed" }, { status: 502 });
  }
}
