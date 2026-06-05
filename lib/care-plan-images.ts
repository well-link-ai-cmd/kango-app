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
 * Claude に渡せる添付（画像=vision）へ変換する。
 * - 画像（jpeg/png/webp/gif）→ images（Claude vision）
 * - PDF・Excel 等はAIに渡さない（保存・閲覧のみ）
 *   ※ ケアプランPDFには利用者の氏名・住所・生年月日などの個人情報が含まれるため、
 *     Anthropic へ送らない方針（個人情報の越境送信を避ける）。
 *     ケアプランの内容をAIに反映したい場合は、個人情報をマスクした写真で登録してもらう運用とする。
 * - 認証済みユーザーの Supabase クライアントで取得（RLSに従う）
 * - max 件で打ち切り（トークン/コスト保護）
 *
 * documents は後方互換のため常に空配列を返す（呼び出し側の signature 維持）。
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
      }
      // 画像以外（PDF・Excel 等）はAIに渡さない（保存・閲覧のみ）。
      // PDFは個人情報（氏名・住所・生年月日等）を含むため Anthropic へ送らない。
      // 内容をAIに反映したい場合は、個人情報をマスクした写真で登録してもらう。
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
