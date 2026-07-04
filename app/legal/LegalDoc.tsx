"use client";

import ReactMarkdown from "react-markdown";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import "../guide/guide.css";

/** 利用規約・プライバシーポリシー等のMarkdown本文を描画する共通クライアント。 */
export default function LegalDoc({ title, md }: { title: string; md: string }) {
  return (
    <div style={{ position: "relative", zIndex: 1, minHeight: "100vh" }}>
      <header className="app-header">
        <div className="app-header-inner">
          <Link href="/patients" className="header-back" aria-label="戻る">
            <ArrowLeft size={20} />
          </Link>
          <div style={{ flex: 1 }}>
            <h1>{title}</h1>
            <div className="subtitle">AI訪問看護記録アシスト</div>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: "48rem", margin: "0 auto", padding: "20px 16px 80px" }}>
        <div className="guide-md">
          <ReactMarkdown>{md}</ReactMarkdown>
        </div>
      </main>
    </div>
  );
}
