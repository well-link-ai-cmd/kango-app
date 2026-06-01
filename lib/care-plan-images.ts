import { getServerSupabase } from "./supabase-server";
import type { AiImageInput } from "./ai-client";

// Storage バケット名（migration 010 と一致させること）
const BUCKET = "patient-files";

// Claude vision が受け付ける media_type のみ許可（HEIC等は対象外）
const ALLOWED: Record<string, AiImageInput["mediaType"]> = {
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
  "image/gif": "image/gif",
};

/**
 * patient-files バケットの画像パス配列を、サーバー側でダウンロードして
 * Claude vision 用の base64 画像（AiImageInput[]）に変換する。
 * - 認証済みユーザーの Supabase クライアントで取得（RLSに従う）
 * - 読めない/未対応形式（HEIC等）はスキップ
 * - max 枚で打ち切り（トークン/コスト保護）
 * - クライアントから大きな base64 を受け取らずに済むため Vercel の body 上限も回避
 */
export async function loadCarePlanImages(
  paths: string[] | undefined,
  max = 4
): Promise<AiImageInput[]> {
  if (!paths || paths.length === 0) return [];
  let supabase;
  try {
    supabase = await getServerSupabase();
  } catch {
    return [];
  }
  const out: AiImageInput[] = [];
  for (const path of paths.slice(0, max)) {
    try {
      const { data, error } = await supabase.storage.from(BUCKET).download(path);
      if (error || !data) continue;
      const mediaType = ALLOWED[(data.type || "").toLowerCase()];
      if (!mediaType) continue; // 未対応形式はスキップ
      const buf = Buffer.from(await data.arrayBuffer());
      out.push({ mediaType, data: buf.toString("base64") });
    } catch {
      // 1枚の失敗で全体を止めない
    }
  }
  return out;
}
