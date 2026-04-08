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

  useEffect(() => {
    const supabase = getSupabase();
    // 既存セッションを確認
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      setChecking(false);
    });

    // 認証状態の変化を監視
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleLogin(e: React.FormEvent) {
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
      <form onSubmit={handleLogin} style={{
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

        {error && (
          <p style={{
            color: "#e53e3e",
            fontSize: "0.875rem",
            marginBottom: "1rem",
          }}>
            {error}
          </p>
        )}

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
    </div>
  );
}
