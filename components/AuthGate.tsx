"use client";

import { useState, useEffect, ReactNode } from "react";
import { getSupabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

type AuthStep =
  | "checking"       // 認証状態確認中
  | "login"          // ログイン画面
  | "verifying"      // アクセス権確認中
  | "needs_setup"    // 初期セットアップ
  | "needs_password" // パスワード入力
  | "not_allowed"    // アクセス拒否
  | "granted";       // アクセス許可

export default function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [step, setStep] = useState<AuthStep>("checking");
  const [orgPassword, setOrgPassword] = useState("");
  const [setupPassword, setSetupPassword] = useState("");
  const [setupPasswordConfirm, setSetupPasswordConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [userRole, setUserRole] = useState<string>("");

  useEffect(() => {
    const supabase = getSupabase();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      if (user) {
        checkAccess(user);
      } else {
        setStep("login");
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const newUser = session?.user ?? null;
      setUser(newUser);
      if (newUser && step === "login") {
        checkAccess(newUser);
      } else if (!newUser) {
        setStep("login");
        setUserRole("");
        sessionStorage.removeItem("access_verified");
      }
    });

    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function checkAccess(currentUser: User) {
    // セッション中に既に検証済みならスキップ
    const verified = sessionStorage.getItem("access_verified");
    if (verified === currentUser.email) {
      const savedRole = sessionStorage.getItem("user_role") || "";
      setUserRole(savedRole);
      setStep("granted");
      return;
    }

    setStep("verifying");
    try {
      const res = await fetch("/api/auth/check-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();

      switch (data.status) {
        case "no_table":
          // マイグレーション未実行 → そのままアクセス許可
          sessionStorage.setItem("access_verified", currentUser.email!);
          setStep("granted");
          break;
        case "needs_setup":
          setStep("needs_setup");
          break;
        case "needs_password":
          setStep("needs_password");
          break;
        case "not_allowed":
          setStep("not_allowed");
          break;
        case "ok":
          setUserRole(data.role || "");
          sessionStorage.setItem("access_verified", currentUser.email!);
          sessionStorage.setItem("user_role", data.role || "");
          setStep("granted");
          break;
        default:
          setError("予期しないエラーが発生しました");
          setStep("login");
      }
    } catch {
      setError("通信エラーが発生しました");
      setStep("login");
    }
  }

  async function handleGoogleLogin() {
    setError("");
    setLoading(true);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}`,
        },
      });
      if (error) {
        setError("Googleログインに失敗しました");
      }
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/check-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: orgPassword }),
      });
      const data = await res.json();

      if (data.status === "ok") {
        setUserRole(data.role || "");
        sessionStorage.setItem("access_verified", user!.email!);
        sessionStorage.setItem("user_role", data.role || "");
        setStep("granted");
      } else if (data.status === "wrong_password") {
        setError("パスワードが正しくありません");
      } else {
        setError(data.error || "アクセスが拒否されました");
      }
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (setupPassword !== setupPasswordConfirm) {
      setError("パスワードが一致しません");
      return;
    }
    if (setupPassword.length < 4) {
      setError("パスワードは4文字以上で設定してください");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: setupPassword }),
      });
      const data = await res.json();

      if (data.status === "ok") {
        setUserRole("admin");
        sessionStorage.setItem("access_verified", user!.email!);
        sessionStorage.setItem("user_role", "admin");
        setStep("granted");
      } else {
        setError(data.error || "セットアップに失敗しました");
      }
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    const supabase = getSupabase();
    await supabase.auth.signOut();
    sessionStorage.removeItem("access_verified");
    sessionStorage.removeItem("user_role");
    setStep("login");
    setUser(null);
    setOrgPassword("");
    setError("");
  }

  // --- レンダリング ---

  if (step === "checking" || step === "verifying") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "var(--text-muted, #999)", fontSize: "0.9rem" }}>
          {step === "checking" ? "認証確認中..." : "アクセス権を確認中..."}
        </p>
      </div>
    );
  }

  if (step === "granted") {
    return <>{children}</>;
  }

  // ログイン画面・パスワード入力・セットアップ・拒否画面
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "1rem",
    }}>
      <div style={{
        background: "var(--bg-card, #fff)",
        borderRadius: "16px",
        padding: "2.5rem 2rem",
        boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
        maxWidth: "400px",
        width: "100%",
        textAlign: "center",
      }}>
        {/* --- ログイン画面 --- */}
        {step === "login" && (
          <>
            <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🔒</div>
            <h1 style={{
              fontSize: "1.25rem",
              fontWeight: 700,
              marginBottom: "0.5rem",
              color: "var(--text-primary, #1a1a1a)",
            }}>
              AI訪問看護記録アシスト
            </h1>
            <p style={{
              fontSize: "0.875rem",
              color: "var(--text-secondary, #666)",
              marginBottom: "1.5rem",
            }}>
              ログインしてください
            </p>

            {error && <ErrorMessage message={error} />}

            <button
              onClick={handleGoogleLogin}
              disabled={loading}
              style={{
                width: "100%",
                padding: "0.75rem",
                borderRadius: "8px",
                background: "#fff",
                color: "#333",
                fontWeight: 600,
                fontSize: "1rem",
                border: "1px solid #ddd",
                cursor: loading ? "wait" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.5rem",
                opacity: loading ? 0.6 : 1,
              }}
            >
              <GoogleIcon />
              {loading ? "ログイン中..." : "Googleアカウントでログイン"}
            </button>
          </>
        )}

        {/* --- パスワード入力画面 --- */}
        {step === "needs_password" && (
          <>
            <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🔑</div>
            <h1 style={{
              fontSize: "1.25rem",
              fontWeight: 700,
              marginBottom: "0.25rem",
              color: "var(--text-primary, #1a1a1a)",
            }}>
              パスワード入力
            </h1>
            <p style={{
              fontSize: "0.8rem",
              color: "var(--text-muted, #999)",
              marginBottom: "0.25rem",
            }}>
              {user?.email}
            </p>
            <p style={{
              fontSize: "0.875rem",
              color: "var(--text-secondary, #666)",
              marginBottom: "1.5rem",
            }}>
              事業所パスワードを入力してください
            </p>

            {error && <ErrorMessage message={error} />}

            <form onSubmit={handlePasswordSubmit}>
              <input
                type="password"
                value={orgPassword}
                onChange={(e) => setOrgPassword(e.target.value)}
                placeholder="パスワード"
                autoFocus
                autoComplete="current-password"
                style={inputStyle}
              />
              <button
                type="submit"
                disabled={loading || !orgPassword}
                className="btn-primary"
                style={{ marginTop: "0.5rem", opacity: loading || !orgPassword ? 0.5 : 1 }}
              >
                {loading ? "確認中..." : "入室する"}
              </button>
            </form>

            <button onClick={handleLogout} style={linkButtonStyle}>
              別のアカウントでログイン
            </button>
          </>
        )}

        {/* --- 初期セットアップ画面 --- */}
        {step === "needs_setup" && (
          <>
            <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>⚙️</div>
            <h1 style={{
              fontSize: "1.25rem",
              fontWeight: 700,
              marginBottom: "0.25rem",
              color: "var(--text-primary, #1a1a1a)",
            }}>
              初期セットアップ
            </h1>
            <p style={{
              fontSize: "0.8rem",
              color: "var(--text-muted, #999)",
              marginBottom: "0.25rem",
            }}>
              {user?.email}
            </p>
            <p style={{
              fontSize: "0.875rem",
              color: "var(--text-secondary, #666)",
              marginBottom: "1.5rem",
              lineHeight: 1.6,
            }}>
              あなたが最初の管理者になります。<br />
              事業所パスワードを設定してください。
            </p>

            {error && <ErrorMessage message={error} />}

            <form onSubmit={handleSetup}>
              <input
                type="password"
                value={setupPassword}
                onChange={(e) => setSetupPassword(e.target.value)}
                placeholder="事業所パスワード（4文字以上）"
                autoFocus
                autoComplete="new-password"
                style={inputStyle}
              />
              <input
                type="password"
                value={setupPasswordConfirm}
                onChange={(e) => setSetupPasswordConfirm(e.target.value)}
                placeholder="パスワード（確認）"
                autoComplete="new-password"
                style={inputStyle}
              />
              <button
                type="submit"
                disabled={loading || !setupPassword || !setupPasswordConfirm}
                className="btn-primary"
                style={{ marginTop: "0.5rem", opacity: loading || !setupPassword || !setupPasswordConfirm ? 0.5 : 1 }}
              >
                {loading ? "設定中..." : "セットアップ完了"}
              </button>
            </form>

            <button onClick={handleLogout} style={linkButtonStyle}>
              別のアカウントでログイン
            </button>
          </>
        )}

        {/* --- アクセス拒否画面 --- */}
        {step === "not_allowed" && (
          <>
            <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🚫</div>
            <h1 style={{
              fontSize: "1.25rem",
              fontWeight: 700,
              marginBottom: "0.5rem",
              color: "var(--text-primary, #1a1a1a)",
            }}>
              アクセスが許可されていません
            </h1>
            <p style={{
              fontSize: "0.8rem",
              color: "var(--text-muted, #999)",
              marginBottom: "0.5rem",
            }}>
              {user?.email}
            </p>
            <p style={{
              fontSize: "0.875rem",
              color: "var(--text-secondary, #666)",
              marginBottom: "1.5rem",
              lineHeight: 1.6,
            }}>
              このメールアドレスはアクセスが許可されていません。<br />
              管理者にお問い合わせください。
            </p>
            <button onClick={handleLogout} style={linkButtonStyle}>
              別のアカウントでログイン
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** ユーザーの管理者ロールを取得 */
export function getUserRole(): string {
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem("user_role") || "";
}

// --- 共通スタイル ---

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.75rem 1rem",
  borderRadius: "8px",
  border: "1px solid var(--border, #e0e0e0)",
  fontSize: "1rem",
  marginBottom: "0.75rem",
  boxSizing: "border-box",
  outline: "none",
};

const linkButtonStyle: React.CSSProperties = {
  marginTop: "1rem",
  background: "none",
  border: "none",
  color: "var(--text-muted, #999)",
  fontSize: "0.8rem",
  cursor: "pointer",
  textDecoration: "underline",
};

function ErrorMessage({ message }: { message: string }) {
  return (
    <p style={{
      color: "#e53e3e",
      fontSize: "0.875rem",
      marginBottom: "1rem",
      background: "rgba(229, 62, 62, 0.05)",
      padding: "0.5rem 0.75rem",
      borderRadius: "8px",
    }}>
      {message}
    </p>
  );
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}
