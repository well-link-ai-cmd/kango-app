"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Shield, User, Trash2, Building2, Copy, RefreshCw } from "lucide-react";
import { getUserRole } from "@/components/AuthGate";
import { getSupabase } from "@/lib/supabase";

interface Member {
  user_id: string;
  email: string;
  display_name: string | null;
  role: string;
  joined_at: string;
}

export default function AdminPage() {
  const router = useRouter();
  const [members, setMembers] = useState<Member[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [org, setOrg] = useState<{ name: string; join_code: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [codeCopied, setCodeCopied] = useState(false);
  const [busy, setBusy] = useState(false); // 権限変更・削除・再発行の進行中

  useEffect(() => {
    const role = getUserRole();
    if (role !== "admin") {
      router.push("/patients");
      return;
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function init() {
    setLoading(true);
    try {
      const { data: { user } } = await getSupabase().auth.getUser();
      setCurrentUserId(user?.id ?? "");
      await Promise.all([loadOrg(), loadMembers()]);
    } finally {
      setLoading(false);
    }
  }

  async function loadOrg() {
    const { data, error } = await getSupabase()
      .from("organizations")
      .select("name, join_code")
      .limit(1);
    if (!error && data && data.length > 0) {
      setOrg({ name: data[0].name, join_code: data[0].join_code });
    }
  }

  async function loadMembers() {
    const { data, error } = await getSupabase().rpc("list_org_members");
    if (error) {
      setError("メンバー一覧の取得に失敗しました（DB関数 migration 012 が未適用の可能性があります）");
      return;
    }
    setMembers((data ?? []) as Member[]);
  }

  async function copyJoinCode() {
    if (!org) return;
    try {
      await navigator.clipboard.writeText(org.join_code);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 1500);
    } catch {
      // クリップボード不可は無視
    }
  }

  async function regenerateCode() {
    if (!confirm("参加コードを再発行しますか？\n古いコードは使えなくなります（既に参加済みのメンバーには影響しません）。")) return;
    setError(""); setSuccess(""); setBusy(true);
    try {
      const { data, error } = await getSupabase().rpc("regenerate_join_code");
      if (error) { setError("再発行に失敗しました"); return; }
      setOrg((o) => (o ? { ...o, join_code: data as string } : o));
      setSuccess("参加コードを再発行しました。新しいコードをスタッフに共有してください。");
    } finally { setBusy(false); }
  }

  async function changeRole(m: Member, newRole: "admin" | "user") {
    const label = newRole === "admin" ? "管理者に昇格" : "一般ユーザーに変更";
    if (!confirm(`${m.display_name || m.email} を${label}しますか？`)) return;
    setError(""); setSuccess(""); setBusy(true);
    try {
      const { error } = await getSupabase().rpc("set_member_role", { target_user: m.user_id, new_role: newRole });
      if (error) {
        setError(/last_admin/.test(error.message ?? "") ? "最後の管理者は降格できません" : "権限の変更に失敗しました");
        return;
      }
      setSuccess(`${m.display_name || m.email} を${label}しました`);
      await loadMembers();
    } finally { setBusy(false); }
  }

  async function removeMember(m: Member) {
    if (!confirm(`${m.display_name || m.email} を事業所から外しますか？\nこの利用者はアプリにアクセスできなくなります（作成済みの記録データは残ります）。`)) return;
    setError(""); setSuccess(""); setBusy(true);
    try {
      const { error } = await getSupabase().rpc("remove_member", { target_user: m.user_id });
      if (error) {
        setError(/last_admin/.test(error.message ?? "") ? "最後の管理者は削除できません" : "削除に失敗しました");
        return;
      }
      setSuccess(`${m.display_name || m.email} を事業所から外しました`);
      await loadMembers();
    } finally { setBusy(false); }
  }

  const adminCount = members.filter((m) => m.role === "admin").length;

  return (
    <div style={{ position: "relative", zIndex: 1, minHeight: "100vh" }}>
      {/* ヘッダー */}
      <header className="app-header">
        <div className="app-header-inner">
          <button onClick={() => router.push("/patients")} className="header-back" aria-label="戻る">
            <ArrowLeft size={20} />
          </button>
          <div style={{ flex: 1 }}>
            <h1>事業所・メンバー管理</h1>
            <div className="subtitle">参加コードの共有・メンバーの権限管理</div>
          </div>
          <Shield size={20} style={{ color: "var(--accent-cyan)" }} />
        </div>
      </header>

      <main style={{ maxWidth: "42rem", margin: "0 auto", padding: "20px 16px 80px" }}>
        {/* 通知メッセージ */}
        {error && (
          <div className="alert-error" style={{ marginBottom: "16px" }}>
            {error}
          </div>
        )}
        {success && (
          <div style={{
            background: "rgba(0, 200, 150, 0.05)",
            borderRadius: "10px",
            padding: "12px 16px",
            color: "var(--accent-success)",
            fontSize: "0.875rem",
            marginBottom: "16px",
          }}>
            {success}
          </div>
        )}

        {/* 事業所の参加コード */}
        {org && (
          <div className="card" style={{ padding: "20px", marginBottom: "16px" }}>
            <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
              <Building2 size={18} style={{ color: "var(--accent-cyan)" }} />
              事業所の参加コード
            </h2>
            <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "4px" }}>{org.name}</p>
            <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "12px", lineHeight: 1.6 }}>
              スタッフはこのコードで参加できます。ログイン画面の「既存の事業所に参加する」に入力してもらってください。新しいメール登録は不要（Googleログインのみ）。参加した人は最初は「一般ユーザー」で、下の一覧から管理者に変更できます。
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <code style={{
                flex: "1 1 160px",
                fontSize: "1.25rem",
                fontWeight: 700,
                letterSpacing: "0.15em",
                padding: "10px 14px",
                background: "var(--bg-tertiary)",
                borderRadius: "10px",
                userSelect: "all",
              }}>
                {org.join_code}
              </code>
              <button onClick={copyJoinCode} className="btn-outline" style={{ display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap" }}>
                <Copy size={15} />
                {codeCopied ? "コピー済み" : "コピー"}
              </button>
              <button onClick={regenerateCode} disabled={busy} className="btn-outline" style={{ display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap", opacity: busy ? 0.5 : 1 }} title="漏えい時など、コードを作り直します">
                <RefreshCw size={15} />
                再発行
              </button>
            </div>
          </div>
        )}

        {/* メンバー一覧 */}
        <div className="card" style={{ padding: "20px" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
            <User size={18} style={{ color: "var(--accent-cyan)" }} />
            メンバー一覧
            <span className="badge badge-gray" style={{ marginLeft: "auto" }}>{members.length}名</span>
          </h2>

          {loading ? (
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", textAlign: "center", padding: "20px" }}>
              読み込み中...
            </p>
          ) : members.length === 0 ? (
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", textAlign: "center", padding: "20px" }}>
              メンバーがいません
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {members.map((m) => {
                const isSelf = m.user_id === currentUserId;
                const isAdmin = m.role === "admin";
                const isLastAdmin = isAdmin && adminCount <= 1;
                return (
                  <div
                    key={m.user_id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      padding: "12px 16px",
                      background: "var(--bg-tertiary)",
                      borderRadius: "12px",
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{
                      width: "36px",
                      height: "36px",
                      borderRadius: "50%",
                      background: isAdmin ? "var(--gradient-main)" : "var(--bg-tertiary)",
                      border: isAdmin ? "none" : "2px solid var(--text-muted)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}>
                      {isAdmin ? <Shield size={16} color="white" /> : <User size={16} color="var(--text-muted)" />}
                    </div>
                    <div style={{ flex: "1 1 160px", minWidth: 0 }}>
                      <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text-primary)" }}>
                        {m.display_name || m.email}
                        {isSelf && <span style={{ color: "var(--text-muted)", fontWeight: 400, marginLeft: "6px", fontSize: "0.8rem" }}>（あなた）</span>}
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {m.email}
                        {isAdmin && <span className="badge badge-blue" style={{ marginLeft: "8px" }}>管理者</span>}
                      </div>
                    </div>

                    {/* 権限切替 */}
                    {isAdmin ? (
                      <button
                        onClick={() => changeRole(m, "user")}
                        disabled={busy || isLastAdmin}
                        className="btn-outline"
                        style={{ fontSize: "0.8rem", padding: "6px 10px", opacity: busy || isLastAdmin ? 0.5 : 1 }}
                        title={isLastAdmin ? "最後の管理者は降格できません" : "一般ユーザーにする"}
                      >
                        一般にする
                      </button>
                    ) : (
                      <button
                        onClick={() => changeRole(m, "admin")}
                        disabled={busy}
                        className="btn-outline"
                        style={{ fontSize: "0.8rem", padding: "6px 10px", opacity: busy ? 0.5 : 1 }}
                        title="管理者にする"
                      >
                        管理者にする
                      </button>
                    )}

                    {/* 削除（自分自身は外せない） */}
                    {!isSelf && (
                      <button
                        onClick={() => removeMember(m)}
                        disabled={busy || isLastAdmin}
                        className="btn-delete"
                        title={isLastAdmin ? "最後の管理者は削除できません" : "事業所から外す"}
                        style={{ opacity: busy || isLastAdmin ? 0.5 : 1 }}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "12px", lineHeight: 1.6 }}>
            新しいスタッフを追加するには、上の「参加コード」を共有してください。事前のメール登録は不要です。
          </p>
        </div>
      </main>
    </div>
  );
}
