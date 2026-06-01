"use client";

import { useEffect, useState } from "react";
import {
  uploadPatientImage,
  getImageSignedUrl,
  deletePatientImage,
  type StoredImage,
} from "@/lib/storage";
import { ImagePlus, Trash2, Loader2 } from "lucide-react";

interface ImageUploaderProps {
  value: StoredImage[];
  onChange: (images: StoredImage[]) => void;
  /** Storage 保存先パスの接頭辞（例: "pressure-ulcer/<patientId>"） */
  prefix: string;
  label?: string;
  hint?: string;
  /** 最大枚数（既定10） */
  max?: number;
}

/**
 * 画像アップロード用の共通コンポーネント。
 * - Supabase Storage（patient-files バケット）へアップロードし、参照(StoredImage[])を onChange で返す
 * - private バケットのため表示は署名付きURLで行う
 * - スマホでは「写真を追加」からカメラ/ライブラリを選択可能
 */
export default function ImageUploader({
  value,
  onChange,
  prefix,
  label,
  hint,
  max = 10,
}: ImageUploaderProps) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  // 署名付きURLを取得（表示用）。未取得のパスだけ追加で取得する。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      for (const img of value) {
        if (urls[img.path]) {
          next[img.path] = urls[img.path];
          continue;
        }
        const url = await getImageSignedUrl(img.path);
        if (url) next[img.path] = url;
      }
      if (!cancelled) setUrls(next);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError("");
    setUploading(true);
    try {
      const added: StoredImage[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue;
        if (value.length + added.length >= max) break;
        const img = await uploadPatientImage(file, prefix);
        added.push(img);
      }
      if (added.length > 0) onChange([...value, ...added]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "アップロードに失敗しました");
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove(path: string) {
    onChange(value.filter((i) => i.path !== path));
    await deletePatientImage(path);
  }

  return (
    <div className="space-y-2">
      {label && <p className="input-label">{label}</p>}
      {hint && (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {hint}
        </p>
      )}

      {value.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {value.map((img) => (
            <div
              key={img.path}
              className="relative rounded-lg overflow-hidden"
              style={{ background: "var(--bg-tertiary)", aspectRatio: "1 / 1" }}
            >
              {urls[img.path] ? (
                // 署名付きURLの動的画像のため next/image ではなく img を使用
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={urls[img.path]}
                  alt="登録画像"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <div
                  className="flex items-center justify-center"
                  style={{ width: "100%", height: "100%", color: "var(--text-muted)" }}
                >
                  <Loader2 size={18} className="animate-spin" />
                </div>
              )}
              <button
                type="button"
                onClick={() => handleRemove(img.path)}
                aria-label="削除"
                className="absolute top-1 right-1 rounded-full p-1"
                style={{ background: "rgba(0,0,0,0.55)", color: "#fff" }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {value.length < max && (
        <label
          className="btn-outline"
          style={{ cursor: uploading ? "wait" : "pointer", display: "inline-flex" }}
        >
          {uploading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <ImagePlus size={16} />
          )}
          {uploading ? "アップロード中..." : "写真を追加"}
          <input
            type="file"
            accept="image/*"
            multiple
            hidden
            disabled={uploading}
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      )}

      {error && <div className="alert-error">{error}</div>}
    </div>
  );
}
