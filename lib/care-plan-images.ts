import { getServerSupabase } from "./supabase-server";
import type { AiImageInput, AiDocumentInput } from "./ai-client";

// Storage バケット名（migration 010 と一致させること）
const BUCKET = "patient-files";

// Claude vision が受け付ける media_type のみ許可（HEIC等は対象外）
const ALLOWED_IMAGE: Record<string, AiImageInput["mediaType"]> = {
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
  "image/gif": "image/gif",
};

export interface CarePlanAttachments {
  images: AiImageInput[];
  documents: AiDocumentInput[]; // PDF
}

/**
 * patient-files バケットのパス配列を、サーバー側でダウンロードして
 * Claude に渡せる添付（画像=vision / PDF=document）へ変換する。
 * - 画像（jpeg/png/webp/gif）→ images（Claude vision）
 * - PDF → documents（Claude が直接読む）
 * - Excel 等の未対応形式はスキップ（保存・閲覧は可だが現状AIには渡さない）
 * - 認証済みユーザーの Supabase クライアントで取得（RLSに従う）
 * - max 件で打ち切り（トークン/コスト保護）
 */
export async function loadCarePlanAttachments(
  paths: string[] | undefined,
  max = 4
): Promise<CarePlanAttachments> {
  const result: CarePlanAttachments = { images: [], documents: [] };
  if (!paths || paths.length === 0) return result;
  let supabase;
  try {
    supabase = await getServerSupabase();
  } catch {
    return result;
  }
  for (const path of paths.slice(0, max)) {
    try {
      const { data, error } = await supabase.storage.from(BUCKET).download(path);
      if (error || !data) continue;
      const type = (data.type || "").toLowerCase();
      const buf = Buffer.from(await data.arrayBuffer());
      const imageType = ALLOWED_IMAGE[type];
      if (imageType) {
        result.images.push({ mediaType: imageType, data: buf.toString("base64") });
      } else if (type === "application/pdf" || path.toLowerCase().endsWith(".pdf")) {
        result.documents.push({ mediaType: "application/pdf", data: buf.toString("base64") });
      }
      // それ以外（Excel等）はAIには渡さない（保存・閲覧は可）
    } catch {
      // 1件の失敗で全体を止めない
    }
  }
  return result;
}

/** 後方互換: 画像のみが必要な箇所向け */
export async function loadCarePlanImages(
  paths: string[] | undefined,
  max = 4
): Promise<AiImageInput[]> {
  return (await loadCarePlanAttachments(paths, max)).images;
}
