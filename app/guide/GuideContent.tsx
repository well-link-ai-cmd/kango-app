"use client";

import ReactMarkdown from "react-markdown";
import "./guide.css";

/**
 * 使い方ガイド本文の描画（クライアント）。
 * Markdown 内の画像参照 `images/xxx.png` を、配信用の `/guide/xxx.png` に書き換える。
 */
export default function GuideContent({ md }: { md: string }) {
  return (
    <div className="guide-md">
      <ReactMarkdown
        components={{
          img: ({ src, alt }) => {
            const s = typeof src === "string" ? src.replace(/^images\//, "/guide/") : "";
            // 署名不要の静的配信画像。next/image ではなく img を使用
            // eslint-disable-next-line @next/next/no-img-element
            return <img src={s} alt={alt ?? ""} />;
          },
        }}
      >
        {md}
      </ReactMarkdown>
    </div>
  );
}
