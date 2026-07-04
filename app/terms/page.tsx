import fs from "fs/promises";
import path from "path";
import LegalDoc from "../legal/LegalDoc";

export const metadata = { title: "利用規約 | AI訪問看護記録アシスト" };

async function loadDoc(): Promise<string> {
  try {
    return await fs.readFile(path.join(process.cwd(), "docs", "legal", "利用規約.md"), "utf8");
  } catch {
    return "# 利用規約\n\n（読み込みに失敗しました）";
  }
}

export default async function TermsPage() {
  const md = await loadDoc();
  return <LegalDoc title="利用規約" md={md} />;
}
