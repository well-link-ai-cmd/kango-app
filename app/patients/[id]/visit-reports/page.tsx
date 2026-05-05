"use client";

/**
 * 月次報告書 一覧ページ
 * 患者の過去の通常/精神科 訪問看護報告書を一覧表示。新規作成への導線。
 */

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  getPatients,
  getVisitReports,
  deleteVisitReport,
  type Patient,
  type VisitReport,
} from "@/lib/storage";
import { ArrowLeft, PlusCircle, FileText, Trash2, ChevronDown, ChevronUp, Copy, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";

export default function VisitReportListPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [patient, setPatient] = useState<Patient | null>(null);
  const [reports, setReports] = useState<VisitReport[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const p = (await getPatients()).find((p) => p.id === id) ?? null;
      setPatient(p);
      const rs = await getVisitReports(id);
      setReports(rs);
      setLoaded(true);
    })();
  }, [id]);

  async function handleDelete(reportId: string) {
    if (!confirm("この報告書を削除しますか？")) return;
    await deleteVisitReport(reportId);
    const rs = await getVisitReports(id);
    setReports(rs);
  }

  function handleEdit(reportId: string) {
    router.push(`/patients/${id}/visit-reports/${reportId}/edit`);
  }

  function handleCopy(key: string, text: string) {
    if (!text?.trim()) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ color: "var(--text-muted)" }}>
        読み込み中...
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ color: "var(--text-muted)" }}>
        患者情報が見つかりません
      </div>
    );
  }

  return (
    <div className="min-h-screen relative z-[1]">
      <header className="app-header">
        <div className="app-header-inner">
          <Link href={`/patients/${id}`} className="header-back" aria-label="戻る">
            <ArrowLeft size={22} />
          </Link>
          <div className="flex-1">
            <h1>月次報告書</h1>
            <p className="subtitle">{patient.name} 様</p>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 relative z-[1]">
        <Link
          href={`/patients/${id}/visit-reports/new`}
          className="btn-primary mb-6 animate-fade-in-up"
        >
          <PlusCircle size={22} />
          新しい報告書を作成する
        </Link>

        <h2 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text-muted)" }}>
          過去の報告書（{reports.length}件）
        </h2>

        {reports.length === 0 ? (
          <div className="empty-state">
            <FileText size={36} style={{ color: "var(--text-muted)", opacity: 0.5 }} className="mx-auto mb-3" />
            <p>まだ報告書がありません</p>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              「新しい報告書を作成する」から始めてください
            </p>
          </div>
        ) : (
          <div className="space-y-3 stagger">
            {reports.map((report) => {
              const isOpen = expandedId === report.id;
              const sections = [
                { key: `${report.id}-disease`, label: "病状の経過", value: report.diseaseProgress },
                { key: `${report.id}-nursing`, label: "看護・リハの内容", value: report.nursingContent },
                {
                  key: `${report.id}-family`,
                  label: report.reportType === "psychiatric" ? "家族等との関係" : "家庭での介護の状況",
                  value: report.familyCare,
                },
                { key: `${report.id}-special`, label: "特記すべき事項", value: report.specialNotes },
              ];

              return (
                <div key={report.id} className="card overflow-hidden">
                  <div
                    className="flex items-center px-5 py-4 gap-2"
                    style={{ borderBottom: isOpen ? "1px solid rgba(0,0,0,0.04)" : "none" }}
                  >
                    <button
                      className="flex-1 flex items-center gap-3 text-left min-w-0"
                      onClick={() => setExpandedId(isOpen ? null : report.id)}
                    >
                      <FileText
                        size={18}
                        style={{ color: isOpen ? "var(--accent-cyan)" : "var(--text-muted)", flexShrink: 0 }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>
                            {report.targetMonth}
                          </span>
                          <span
                            className="text-xs px-2 py-0.5 rounded"
                            style={{
                              background:
                                report.reportType === "psychiatric"
                                  ? "rgba(139, 92, 246, 0.15)"
                                  : "rgba(56, 189, 248, 0.15)",
                              color: report.reportType === "psychiatric" ? "#6D28D9" : "#0369A1",
                            }}
                          >
                            {report.reportType === "psychiatric" ? "精神科" : "通常"}
                          </span>
                          {report.isDraft && (
                            <span
                              className="text-xs px-2 py-0.5 rounded"
                              style={{ background: "rgba(245, 158, 11, 0.15)", color: "#B45309" }}
                            >
                              下書き
                            </span>
                          )}
                        </div>
                        <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                          {report.authorName && `${report.authorName} ${report.authorTitle ?? ""} / `}
                          最終更新: {new Date(report.updatedAt).toLocaleString("ja-JP")}
                        </div>
                      </div>
                      {isOpen ? (
                        <ChevronUp size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                      ) : (
                        <ChevronDown size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                      )}
                    </button>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleEdit(report.id)}
                        className="p-2 rounded hover:bg-gray-100"
                        aria-label="報告書を編集"
                        title="編集"
                      >
                        <Pencil size={14} style={{ color: "var(--text-muted)" }} />
                      </button>
                      <button
                        onClick={() => handleDelete(report.id)}
                        className="btn-delete"
                        aria-label="報告書を削除"
                        title="削除"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="p-5 space-y-4 animate-fade-in" style={{ background: "var(--bg-tertiary)" }}>
                      <div className="text-xs space-y-1" style={{ color: "var(--text-muted)" }}>
                        {report.reportType === "psychiatric" && (
                          <div>
                            GAF: {report.gafUnavailable ? "判定不可（家族訪問）" : report.gafScore ?? "-"}
                            {report.gafJudgeDate && ` / 判定日: ${report.gafJudgeDate}`}
                          </div>
                        )}
                        {report.rehabAttachment && (
                          <div>
                            自立度: {report.rehabAttachment.dailyLifeLevel ?? "-"} /
                            認知症: {report.rehabAttachment.dementiaLevel ?? "-"} /
                            Barthel: {report.rehabAttachment.barthelTotal ?? "-"}
                          </div>
                        )}
                        {report.aiModel && (
                          <div>
                            AI: {report.aiModel} / {report.aiPromptVersion}
                          </div>
                        )}
                      </div>

                      {sections.map(({ key, label, value }) =>
                        value?.trim() ? (
                          <div
                            key={key}
                            className="py-2"
                            style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <h4
                                className="text-sm font-semibold"
                                style={{ color: "var(--text-primary)" }}
                              >
                                {label}
                              </h4>
                              <button
                                onClick={() => handleCopy(key, value)}
                                className={`btn-copy ${copiedKey === key ? "btn-copy-success" : ""}`}
                              >
                                <Copy size={14} />
                                {copiedKey === key ? "コピー済！" : "コピー"}
                              </button>
                            </div>
                            <p
                              className="text-sm whitespace-pre-wrap leading-relaxed"
                              style={{ color: "var(--text-primary)" }}
                            >
                              {value}
                            </p>
                          </div>
                        ) : null
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
