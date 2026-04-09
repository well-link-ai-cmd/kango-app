"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, UserPlus, Trash2, KeyRound, Shield, User } from "lucide-react";
import { getUserRole } from "@/components/AuthGate";

interface AllowedUser {
  id: string;
  email: string;
  role: string;
  display_name: string | null;
  created_at: string;
}

export default function AdminPage() {
  const router = useRouter();
  const [users, setUsers] = useState<AllowedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // ユーザー追加フォーム
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<"user" | "admin">("user");
  const [newName, setNewName] = useState("");
  const [addLoading, setAddLoading] = useState(false);

  // パスワード変更
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);

  useEffect(() => {
    const role = getUserRole();
    if (role !== "admin") {
      router.push("/patients");
      return;
    }
    loadUsers();
  }, [router]);

  async function loadUsers() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users");
      const data = await res.json();
      if (res.ok) {
        setUsers(data.users || []);
      } else {
        setError(data.error || "ユーザー一覧の取得に失敗しました");
      }
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setAddLoading(true);

    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newEmail,
          role: newRole,
          display_name: newName || null,
        }),
      });
      const data = await res.json();

      if (res.ok) {
        setSuccess(`${newEmail} を追加しました`);
        setNewEmail("");
        setNewName("");
        setNewRole("user");
        await loadUsers();
      } else {
        setError(data.error);
      }
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setAddLoading(false);
    }
  }

  async function handleDeleteUser(user: AllowedUser) {
    if (!confirm(`${user.email} のアクセス権を削除しますか？`)) return;
    setError("");
    setSuccess("");

    try {
      const res = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: user.id }),
      });
      const data = await res.json();

      if (res.ok) {
        setSuccess(`${user.email} を削除しました`);
        await loadUsers();
      } else {
        setError(data.error);
      }
    } catch {
      setError("通信エラーが発生しました");
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (newPassword !== newPasswordConfirm) {
      setError("新しいパスワードが一致しません");
      return;
    }
    if (newPassword.length < 4) {
      setError("パスワードは4文字以上で設定してください");
      return;
    }

    setPasswordLoading(true);
    try {
      const res = await fetch("/api/admin/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();

      if (res.ok) {
        setSuccess("パスワードを変更しました");
        setCurrentPassword("");
        setNewPassword("");
        setNewPasswordConfirm("");
        setShowPasswordForm(false);
      } else {
        setError(data.error);
      }
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setPasswordLoading(false);
    }
  }

  return (
    <div style={{ position: "relative", zIndex: 1, minHeight: "100vh" }}>
      {/* ヘッダー */}
      <header className="app-header">
        <div className="app-header-inner">
          <button onClick={() => router.push("/patients")} className="header-back" aria-label="戻る">
            <ArrowLeft size={20} />
          </button>
          <div style={{ flex: 1 }}>
            <h1>管理者設定</h1>
            <div className="subtitle">アクセス管理・パスワード設定</div>
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

        {/* ユーザー追加 */}
        <div className="card" style={{ padding: "20px", marginBottom: "16px" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
            <UserPlus size={18} style={{ color: "var(--accent-cyan)" }} />
            ユーザー追加
          </h2>
          <form onSubmit={handleAddUser}>
            <div style={{ marginBottom: "12px" }}>
              <label className="input-label">メールアドレス *</label>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="example@gmail.com"
                required
                className="input-field"
              />
            </div>
            <div style={{ marginBottom: "12px" }}>
              <label className="input-label">表示名（任意）</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="田中 花子"
                className="input-field"
              />
            </div>
            <div style={{ marginBottom: "16px" }}>
              <label className="input-label">権限</label>
              <div style={{ display: "flex", gap: "12px" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.9rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="role"
                    value="user"
                    checked={newRole === "user"}
                    onChange={() => setNewRole("user")}
                  />
                  一般ユーザー
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.9rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="role"
                    value="admin"
                    checked={newRole === "admin"}
                    onChange={() => setNewRole("admin")}
                  />
                  管理者
                </label>
              </div>
            </div>
            <button
              type="submit"
              disabled={addLoading || !newEmail}
              className="btn-primary"
              style={{ opacity: addLoading || !newEmail ? 0.5 : 1 }}
            >
              {addLoading ? "追加中..." : "ユーザーを追加"}
            </button>
          </form>
        </div>

        {/* 許可ユーザー一覧 */}
        <div className="card" style={{ padding: "20px", marginBottom: "16px" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
            <User size={18} style={{ color: "var(--accent-cyan)" }} />
            許可ユーザー一覧
            <span className="badge badge-gray" style={{ marginLeft: "auto" }}>{users.length}名</span>
          </h2>

          {loading ? (
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", textAlign: "center", padding: "20px" }}>
              読み込み中...
            </p>
          ) : users.length === 0 ? (
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", textAlign: "center", padding: "20px" }}>
              ユーザーが登録されていません
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {users.map((u) => (
                <div
                  key={u.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    padding: "12px 16px",
                    background: "var(--bg-tertiary)",
                    borderRadius: "12px",
                  }}
                >
                  <div style={{
                    width: "36px",
                    height: "36px",
                    borderRadius: "50%",
                    background: u.role === "admin" ? "var(--gradient-main)" : "var(--bg-tertiary)",
                    border: u.role === "admin" ? "none" : "2px solid var(--text-muted)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}>
                    {u.role === "admin" ? (
                      <Shield size={16} color="white" />
                    ) : (
                      <User size={16} color="var(--text-muted)" />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text-primary)" }}>
                      {u.display_name || u.email}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {u.email}
                      {u.role === "admin" && (
                        <span className="badge badge-blue" style={{ marginLeft: "8px" }}>管理者</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteUser(u)}
                    className="btn-delete"
                    title="削除"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* パスワード変更 */}
        <div className="card" style={{ padding: "20px" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
            <KeyRound size={18} style={{ color: "var(--accent-cyan)" }} />
            事業所パスワード
          </h2>

          {!showPasswordForm ? (
            <button
              onClick={() => setShowPasswordForm(true)}
              className="btn-outline"
            >
              パスワードを変更する
            </button>
          ) : (
            <form onSubmit={handleChangePassword}>
              <div style={{ marginBottom: "12px" }}>
                <label className="input-label">現在のパスワード</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="現在のパスワード"
                  autoComplete="current-password"
                  className="input-field"
                />
              </div>
              <div style={{ marginBottom: "12px" }}>
                <label className="input-label">新しいパスワード</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="新しいパスワード（4文字以上）"
                  autoComplete="new-password"
                  className="input-field"
                />
              </div>
              <div style={{ marginBottom: "16px" }}>
                <label className="input-label">新しいパスワード（確認）</label>
                <input
                  type="password"
                  value={newPasswordConfirm}
                  onChange={(e) => setNewPasswordConfirm(e.target.value)}
                  placeholder="新しいパスワード（確認）"
                  autoComplete="new-password"
                  className="input-field"
                />
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  onClick={() => {
                    setShowPasswordForm(false);
                    setCurrentPassword("");
                    setNewPassword("");
                    setNewPasswordConfirm("");
                  }}
                  className="btn-outline"
                  style={{ flex: 1 }}
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={passwordLoading || !newPassword || !newPasswordConfirm}
                  className="btn-save"
                  style={{ flex: 1, opacity: passwordLoading || !newPassword || !newPasswordConfirm ? 0.5 : 1 }}
                >
                  {passwordLoading ? "変更中..." : "変更する"}
                </button>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
