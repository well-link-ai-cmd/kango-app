"use client";

import { useState, useEffect, ReactNode } from "react";
import { usePathname } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

// ログイン不要で閲覧できる公開ページ（規約・プライバシーポリシー）。
// ※ 既存ルートの認証挙動は変えない。新規の法務ページのみ認証をバイパスする。
const PUBLIC_PATHS = ["/terms", "/privacy"];

type AuthStep =
  | "checking"       // 認証状態確認中
  | "login"          // ログイン画面
  | "verifying"      // アクセス権確認中
  | "onboarding"     // 事業所の作成 / 参加（マルチテナント）
  | "needs_setup"    // 初期セットアップ（レガシー: 011未適用時）
  | "needs_password" // パスワード入力（レガシー: 011未適用時）
  | "not_allowed"    // アクセス拒否（レガシー: 011未適用時）
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
  // オンボーディング（事業所の作成 / 参加）
  const [newOrgName, setNewOrgName] = useState("");
  const [joinInput, setJoinInput] = useState("");
  const [createdJoinCode, setCreatedJoinCode] = useState("");
  const pathname = usePathname();
  const isPublicPath = PUBLIC_PATHS.includes(pathname ?? "");

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

  function grant(currentUser: User, role: string) {
    setUserRole(role);
    sessionStorage.setItem("access_verified", currentUser.email!);
    sessionStorage.setItem("user_role", role);
    setStep("granted");
  }

  async function checkAccess(currentUser: User) {
    // セッション中に既に検証済みならスキップ
    const verified = sessionStorage.getItem("access_verified");
    if (verified === currentUser.email) {
      setUserRole(sessionStorage.getItem("user_role") || "");
      setStep("granted");
      return;
    }

    setStep("verifying");

    // マルチテナント: 所属事業所（membership）の有無でアクセス判定する。
    try {
      const supabase = getSupabase();
      const { data: memberships, error } = await supabase
        .from("memberships")
        .select("role")
        .eq("user_id", currentUser.id);

      if (!error) {
        // membership システムが有効（migration 011 適用済み）
        if (memberships && memberships.length > 0) {
          grant(currentUser, memberships[0].role || "user");
          return;
        }
        // 未所属 → メール招待があれば自動参加を試みる（migration 013）
        const { data: accepted } = await supabase.rpc("accept_invites");
        if (accepted && (accepted as number) > 0) {
          const { data: joined } = await supabase
            .from("memberships")
            .select("role")
            .eq("user_id", currentUser.id);
          if (joined && joined.length > 0) {
            grant(currentUser, joined[0].role || "user");
            return;
          }
        }
        // 招待もなし → オンボーディング（作成 / 参加コード）へ
        setStep("onboarding");
        return;
      }
      // error（memberships テーブル未作成など）→ レガシーフローへフォールバック
    } catch {
      // フォールバックへ
    }

    await legacyCheckAccess(currentUser);
  }

  // --- レガシー（migration 011 未適用時）の許可リスト＋事業所パスワード方式 ---
  async function legacyCheckAccess(currentUser: User) {
    try {
      const res = await fetch("/api/auth/check-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();

      switch (data.status) {
        case "no_table":
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
          grant(currentUser, data.role || "");
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

  // 事業所を新規作成（作成者が管理者になる）
  async function handleCreateOrg(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!newOrgName.trim()) return;
    setLoading(true);
    try {
      const supabase = getSupabase();
      const { data: newOrgId, error } = await supabase.rpc("create_organization", {
        org_name: newOrgName.trim(),
      });
      if (error) {
        setError("事業所の作成に失敗しました。時間をおいて再度お試しください。");
        return;
      }
      // 参加コードを取得してスタッフ共有用に表示
      const { data: org } = await supabase
        .from("organizations")
        .select("join_code")
        .eq("id", newOrgId)
        .maybeSingle();
      setCreatedJoinCode(org?.join_code ?? "");
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }

  // 参加コードで既存の事業所に参加
  async function handleJoinOrg(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!joinInput.trim()) return;
    setLoading(true);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.rpc("join_organization", {
        code: joinInput.trim(),
      });
      if (error) {
        setError(
          /invalid_code/.test(error.message ?? "")
            ? "参加コードが正しくありません。管理者にご確認ください。"
            : "事業所への参加に失敗しました。"
        );
        return;
      }
      finishOnboarding();
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }

  // オンボーディング完了 → 再読込で所属事業所のデータを読み直す
  function finishOnboarding() {
    sessionStorage.removeItem("access_verified");
    window.location.reload();
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

  // 公開ページ（規約・プライバシーポリシー）はログイン不要で表示する
  if (isPublicPath) {
    return <>{children}</>;
  }

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

            <p style={{ marginTop: "1.25rem", fontSize: "0.75rem", color: "var(--text-muted, #999)" }}>
              <a href="/terms" style={legalLinkStyle}>利用規約</a>
              <span style={{ margin: "0 0.4rem" }}>·</span>
              <a href="/privacy" style={legalLinkStyle}>プライバシーポリシー</a>
            </p>
          </>
        )}

        {/* --- オンボーディング: 事業所の作成 / 参加 --- */}
        {step === "onboarding" && (
          <>
            {createdJoinCode ? (
              <>
                <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🎉</div>
                <h1 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "0.5rem", color: "var(--text-primary, #1a1a1a)" }}>
                  事業所を作成しました
                </h1>
                <p style={{ fontSize: "0.875rem", color: "var(--text-secondary, #666)", marginBottom: "1rem", lineHeight: 1.6 }}>
                  下の「参加コード」をスタッフに共有してください。<br />
                  スタッフは同じログイン画面の「既存の事業所に参加する」から入れます。
                </p>
                <div style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "0.15em", padding: "0.75rem", background: "var(--bg-muted, #f5f5f5)", borderRadius: "8px", marginBottom: "0.5rem", userSelect: "all" }}>
                  {createdJoinCode}
                </div>
                <p style={{ fontSize: "0.75rem", color: "var(--text-muted, #999)", marginBottom: "1.25rem" }}>
                  ※ コードは後から「管理」画面でも確認できます
                </p>
                <button onClick={finishOnboarding} className="btn-primary">
                  はじめる
                </button>
              </>
            ) : (
              <>
                <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🏢</div>
                <h1 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "0.25rem", color: "var(--text-primary, #1a1a1a)" }}>
                  事業所の登録
                </h1>
                <p style={{ fontSize: "0.8rem", color: "var(--text-muted, #999)", marginBottom: "1.25rem" }}>
                  {user?.email}
                </p>

                {error && <ErrorMessage message={error} />}

                {/* 新規作成 */}
                <form onSubmit={handleCreateOrg} style={{ marginBottom: "0.5rem" }}>
                  <p style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--text-secondary, #666)", marginBottom: "0.5rem", textAlign: "left" }}>
                    新しい事業所を作る
                  </p>
                  <input
                    type="text"
                    value={newOrgName}
                    onChange={(e) => setNewOrgName(e.target.value)}
                    placeholder="事業所名（例: ○○訪問看護ステーション）"
                    style={inputStyle}
                  />
                  <button type="submit" disabled={loading || !newOrgName.trim()} className="btn-primary" style={{ opacity: loading || !newOrgName.trim() ? 0.5 : 1 }}>
                    {loading ? "作成中..." : "事業所を作成する"}
                  </button>
                </form>

                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", margin: "1rem 0", color: "var(--text-muted, #bbb)", fontSize: "0.75rem" }}>
                  <span style={{ flex: 1, height: 1, background: "var(--border, #eee)" }} />
                  または
                  <span style={{ flex: 1, height: 1, background: "var(--border, #eee)" }} />
                </div>

                {/* 参加 */}
                <form onSubmit={handleJoinOrg}>
                  <p style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--text-secondary, #666)", marginBottom: "0.5rem", textAlign: "left" }}>
                    既存の事業所に参加する
                  </p>
                  <input
                    type="text"
                    value={joinInput}
                    onChange={(e) => setJoinInput(e.target.value.toUpperCase())}
                    placeholder="参加コード（管理者から共有）"
                    autoComplete="off"
                    style={{ ...inputStyle, letterSpacing: "0.1em" }}
                  />
                  <button type="submit" disabled={loading || !joinInput.trim()} className="btn-primary" style={{ opacity: loading || !joinInput.trim() ? 0.5 : 1 }}>
                    {loading ? "参加中..." : "参加する"}
                  </button>
                </form>
              </>
            )}

            <button onClick={handleLogout} style={linkButtonStyle}>
              別のアカウントでログイン
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

const legalLinkStyle: React.CSSProperties = {
  color: "var(--text-muted, #999)",
  textDecoration: "underline",
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
