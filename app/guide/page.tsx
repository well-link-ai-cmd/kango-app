import fs from "fs/promises";
import path from "path";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import GuideContent from "./GuideContent";

export const metadata = { title: "使い方ガイド | AI訪問看護記録アシスト" };

/** リポジトリ内の使い方ガイド(Markdown)をビルド時に読み込む（単一ソース） */
async function loadGuide(): Promise<string> {
  try {
    return await fs.readFile(path.join(process.cwd(), "docs", "使い方ガイド.md"), "utf8");
  } catch {
    return "# 使い方ガイド\n\n（ガイドの読み込みに失敗しました）";
  }
}

export default async function GuidePage() {
  const md = await loadGuide();
  return (
    <div style={{ position: "relative", zIndex: 1, minHeight: "100vh" }}>
      <header className="app-header">
        <div className="app-header-inner">
          <Link href="/patients" className="header-back" aria-label="戻る">
            <ArrowLeft size={20} />
          </Link>
          <div style={{ flex: 1 }}>
            <h1>使い方ガイド</h1>
            <div className="subtitle">AI訪問看護記録アシスト</div>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: "48rem", margin: "0 auto", padding: "20px 16px 80px" }}>
        <GuideContent md={md} />
      </main>
    </div>
  );
}
