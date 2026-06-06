import fs from "fs/promises";
import path from "path";
import LegalDoc from "../legal/LegalDoc";

export const metadata = { title: "プライバシーポリシー | AI訪問看護記録アシスト" };

async function loadDoc(): Promise<string> {
  try {
    return await fs.readFile(path.join(process.cwd(), "docs", "legal", "プライバシーポリシー.md"), "utf8");
  } catch {
    return "# プライバシーポリシー\n\n（読み込みに失敗しました）";
  }
}

export default async function PrivacyPage() {
  const md = await loadDoc();
  return <LegalDoc title="プライバシーポリシー" md={md} />;
}
