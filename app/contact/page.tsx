"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { saveInquiry, type InquiryCategory } from "@/lib/storage";

const CATEGORIES: { value: InquiryCategory; label: string }[] = [
  { value: "bug", label: "不具合の報告" },
  { value: "request", label: "機能の要望" },
  { value: "question", label: "使い方の質問" },
  { value: "other", label: "その他" },
];

export default function ContactPage() {
  const [category, setCategory] = useState<InquiryCategory>("question");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setLoading(true);
    setError("");
    const ok = await saveInquiry({ category, body: body.trim() });
    setLoading(false);
    if (ok) {
      setDone(true);
    } else {
      setError("送信に失敗しました。通信状況をご確認のうえ、もう一度お試しください。");
    }
  }

  return (
    <div style={{ position: "relative", zIndex: 1, minHeight: "100vh" }}>
      <header className="app-header">
        <div className="app-header-inner">
          <Link href="/patients" className="header-back" aria-label="戻る">
            <ArrowLeft size={20} />
          </Link>
          <div style={{ flex: 1 }}>
            <h1>お問い合わせ</h1>
            <div className="subtitle">AI訪問看護記録アシスト</div>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: "40rem", margin: "0 auto", padding: "20px 16px 80px" }}>
        {done ? (
          <div style={{ background: "var(--bg-card, #fff)", borderRadius: 12, padding: "2rem 1.5rem", textAlign: "center" }}>
            <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>✅</div>
            <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "0.5rem" }}>送信しました</h2>
            <p style={{ fontSize: "0.9rem", color: "var(--text-secondary, #666)", lineHeight: 1.7, marginBottom: "1.5rem" }}>
              お問い合わせありがとうございます。<br />内容を確認のうえ、必要に応じてご連絡します。
            </p>
            <Link href="/patients" className="btn-primary" style={{ display: "inline-block", textDecoration: "none" }}>
              利用者一覧へ戻る
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ background: "var(--bg-card, #fff)", borderRadius: 12, padding: "1.5rem" }}>
            <p style={{ fontSize: "0.85rem", color: "var(--text-secondary, #666)", lineHeight: 1.7, marginBottom: "1.25rem" }}>
              不具合・要望・ご質問をお送りください。送信元の事業所・お名前（ログイン中のアカウント）は自動で添付されます。
              <br />※ 利用者の氏名など個人情報は本文に書かないでください。
            </p>

            {error && (
              <p style={{ color: "#e53e3e", fontSize: "0.875rem", marginBottom: "1rem", background: "rgba(229,62,62,0.05)", padding: "0.5rem 0.75rem", borderRadius: 8 }}>
                {error}
              </p>
            )}

            <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.35rem" }}>種別</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as InquiryCategory)}
              style={{ width: "100%", padding: "0.65rem 0.75rem", borderRadius: 8, border: "1px solid var(--border, #e0e0e0)", fontSize: "1rem", marginBottom: "1rem", background: "#fff" }}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>

            <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.35rem" }}>内容</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="お困りの内容やご要望を具体的にご記入ください。"
              rows={8}
              style={{ width: "100%", padding: "0.75rem", borderRadius: 8, border: "1px solid var(--border, #e0e0e0)", fontSize: "1rem", marginBottom: "1.25rem", boxSizing: "border-box", resize: "vertical" }}
            />

            <button
              type="submit"
              disabled={loading || !body.trim()}
              className="btn-primary"
              style={{ width: "100%", opacity: loading || !body.trim() ? 0.5 : 1 }}
            >
              {loading ? "送信中..." : "送信する"}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
