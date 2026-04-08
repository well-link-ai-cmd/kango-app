"use client";

import { useState, useEffect, ReactNode } from "react";
import { getSupabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

export default function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);

  useEffect(() => {
    const supabase = getSupabase();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      setChecking(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

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

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const supabase = getSupabase();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message === "Invalid login credentials"
          ? "メールアドレスまたはパスワードが正しくありません"
          : error.message);
      }
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }

  if (checking) return null;
  if (user) return <>{children}</>;

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
        maxWidth: "360px",
        width: "100%",
        textAlign: "center",
      }}>
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

        {error && (
          <p style={{
            color: "#e53e3e",
            fontSize: "0.875rem",
            marginBottom: "1rem",
          }}>
            {error}
          </p>
        )}

        {/* Googleログインボタン */}
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
            marginBottom: "1rem",
            opacity: loading ? 0.6 : 1,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          {loading ? "ログイン中..." : "Googleアカウントでログイン"}
        </button>

        {/* 区切り線 */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          marginBottom: "1rem",
        }}>
          <div style={{ flex: 1, height: "1px", background: "var(--border, #e0e0e0)" }} />
          <span style={{ fontSize: "0.75rem", color: "var(--text-muted, #999)" }}>または</span>
          <div style={{ flex: 1, height: "1px", background: "var(--border, #e0e0e0)" }} />
        </div>

        {/* メール/パスワードフォーム（折りたたみ） */}
        {!showEmailForm ? (
          <button
            onClick={() => setShowEmailForm(true)}
            style={{
              width: "100%",
              padding: "0.6rem",
              borderRadius: "8px",
              background: "transparent",
              color: "var(--text-secondary, #666)",
              fontSize: "0.875rem",
              border: "1px solid var(--border, #e0e0e0)",
              cursor: "pointer",
            }}
          >
            メールアドレスでログイン
          </button>
        ) : (
          <form onSubmit={handleEmailLogin}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="メールアドレス"
              autoFocus
              autoComplete="email"
              style={{
                width: "100%",
                padding: "0.75rem 1rem",
                borderRadius: "8px",
                border: "1px solid var(--border, #e0e0e0)",
                fontSize: "1rem",
                marginBottom: "0.75rem",
                boxSizing: "border-box",
                outline: "none",
              }}
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="パスワード"
              autoComplete="current-password"
              style={{
                width: "100%",
                padding: "0.75rem 1rem",
                borderRadius: "8px",
                border: "1px solid var(--border, #e0e0e0)",
                fontSize: "1rem",
                marginBottom: "1rem",
                boxSizing: "border-box",
                outline: "none",
              }}
            />
            <button
              type="submit"
              disabled={loading || !email || !password}
              style={{
                width: "100%",
                padding: "0.75rem",
                borderRadius: "8px",
                background: "var(--accent, #0ea5e9)",
                color: "#fff",
                fontWeight: 600,
                fontSize: "1rem",
                border: "none",
                cursor: loading ? "wait" : "pointer",
                opacity: loading || !email || !password ? 0.6 : 1,
              }}
            >
              {loading ? "ログイン中..." : "ログイン"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
