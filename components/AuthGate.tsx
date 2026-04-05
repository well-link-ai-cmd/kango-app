"use client";

import { useState, useEffect, ReactNode } from "react";

const AUTH_KEY = "kango_auth";

export default function AuthGate({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // セッション内で認証済みならスキップ
    if (sessionStorage.getItem(AUTH_KEY) === "true") {
      setAuthed(true);
    }
    setChecking(false);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();

      if (data.ok) {
        sessionStorage.setItem(AUTH_KEY, "true");
        setAuthed(true);
      } else {
        setError(data.error || "認証に失敗しました");
      }
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setLoading(false);
    }
  }

  if (checking) return null;
  if (authed) return <>{children}</>;

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "1rem",
    }}>
      <form onSubmit={handleSubmit} style={{
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
          パスワードを入力してください
        </p>

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="パスワード"
          autoFocus
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
          disabled={loading || !password}
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
            opacity: loading || !password ? 0.6 : 1,
          }}
        >
          {loading ? "確認中..." : "ログイン"}
        </button>
      </form>
    </div>
  );
}
