import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AuthGate from "@/components/AuthGate";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI訪問看護記録アシスト | Well-Link AI",
  description: "訪問看護のSOAP記録をAIがサポートします",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {/* Well-Link AI Background Effects */}
        <div className="app-bg-grid" />
        <div className="app-bg-glow app-bg-glow-1" />
        <div className="app-bg-glow app-bg-glow-2" />
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
