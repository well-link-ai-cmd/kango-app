"use client";

/**
 * 訪問看護情報提供書 一覧ページ
 * 患者の過去の情報提供書（4宛先）を一覧表示。新規作成への導線。
 */

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  getPatients,
  getInfoProvisions,
  deleteInfoProvision,
  INFO_PROVISION_ADDRESSEE_LABEL,
  INFO_PROVISION_FIELDS,
  type Patient,
  type InfoProvision,
  type InfoProvisionAddressee,
} from "@/lib/storage";
import {
  ArrowLeft,
  PlusCircle,
  Mail,
  Trash2,
  ChevronDown,
  ChevronUp,
  Copy,
  Pencil,
  Home,
} from "lucide-react";

const ADDRESSEE_BADGE: Record<InfoProvisionAddressee, { bg: string; color: string }> = {
  municipality:        { bg: "rgba(56, 189, 248, 0.15)", color: "#0369A1" },
  health_center:       { bg: "rgba(139, 92, 246, 0.15)", color: "#6D28D9" },
  school:              { bg: "rgba(34, 197, 94, 0.15)",  color: "#15803D" },
  medical_institution: { bg: "rgba(244, 114, 182, 0.15)", color: "#BE185D" },
};

const FIELD_LABEL_LIST: Record<string, string> = {
  mainDisease: "主傷病名",
  diseaseState: "病状・障害等の状態",
  diseaseProgress: "傷病の経過",
  pastHistory: "既往歴",
  dailyLifeBasics: "食生活・清潔・排泄・睡眠・生活リズム等",
  medicationStatus: "服薬等の状況",
  familyStatus: "家族等について",
  familyCaregiverInfo: "家族等及び主な介護者に係る情報",
  nursingProblems: "看護上の問題等",
  nursingContent: "看護の内容",
  careMethodsContinuation: "ケア時の具体的方法・留意点・継続すべき看護",
  medicalCareMethods: "医療的ケアの実施方法及び留意事項",
  welfareServices: "必要と考えられる保健福祉サービス",
  otherNotes: "その他特筆すべき事項",
};

export default function InfoProvisionListPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [patient, setPatient] = useState<Patient | null>(null);
  const [provisions, setProvisions] = useState<InfoProvision[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const p = (await getPatients()).find((p) => p.id === id) ?? null;
      setPatient(p);
      const ps = await getInfoProvisions(id);
      setProvisions(ps);
      setLoaded(true);
    })();
  }, [id]);

  async function handleDelete(provisionId: string) {
    if (!confirm("この情報提供書を削除しますか？")) return;
    await deleteInfoProvision(provisionId);
    const ps = await getInfoProvisions(id);
    setProvisions(ps);
  }

  function handleEdit(provisionId: string) {
    router.push(`/patients/${id}/info-provisions/${provisionId}/edit`);
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
            <h1>情報提供書</h1>
            <p className="subtitle">{patient.name} 様</p>
          </div>
          <Link href="/patients" className="header-action" aria-label="患者一覧へ戻る" title="患者一覧へ戻る">
            <Home size={20} />
          </Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 relative z-[1]">
        <Link
          href={`/patients/${id}/info-provisions/new`}
          className="btn-primary mb-6 animate-fade-in-up"
        >
          <PlusCircle size={22} />
          新しい情報提供書を作成する
        </Link>

        <h2 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text-muted)" }}>
          過去の情報提供書（{provisions.length}件）
        </h2>

        {provisions.length === 0 ? (
          <div className="empty-state">
            <Mail size={36} style={{ color: "var(--text-muted)", opacity: 0.5 }} className="mx-auto mb-3" />
            <p>まだ情報提供書がありません</p>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              「新しい情報提供書を作成する」から始めてください
            </p>
          </div>
        ) : (
          <div className="space-y-3 stagger">
            {provisions.map((provision) => {
              const isOpen = expandedId === provision.id;
              const badge = ADDRESSEE_BADGE[provision.addresseeType];
              const fields = INFO_PROVISION_FIELDS[provision.addresseeType].filter(
                (f) => f !== "monthlyVisitMonth" && f !== "monthlyVisitDays" && f !== "monthlyVisitCount"
              );

              return (
                <div key={provision.id} className="card overflow-hidden">
                  <div
                    className="flex items-center px-5 py-4 gap-2"
                    style={{ borderBottom: isOpen ? "1px solid rgba(0,0,0,0.04)" : "none" }}
                  >
                    <button
                      className="flex-1 flex items-center gap-3 text-left min-w-0"
                      onClick={() => setExpandedId(isOpen ? null : provision.id)}
                    >
                      <Mail
                        size={18}
                        style={{ color: isOpen ? "var(--accent-cyan)" : "var(--text-muted)", flexShrink: 0 }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className="text-xs px-2 py-0.5 rounded"
                            style={{ background: badge.bg, color: badge.color }}
                          >
                            {INFO_PROVISION_ADDRESSEE_LABEL[provision.addresseeType]}
                          </span>
                          {provision.issuedDate && (
                            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                              作成日: {provision.issuedDate}
                            </span>
                          )}
                          {provision.isDraft && (
                            <span
                              className="text-xs px-2 py-0.5 rounded"
                              style={{ background: "rgba(245, 158, 11, 0.15)", color: "#B45309" }}
                            >
                              下書き
                            </span>
                          )}
                        </div>
                        <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                          {provision.targetPeriodStart && provision.targetPeriodEnd && (
                            <>期間: {provision.targetPeriodStart} 〜 {provision.targetPeriodEnd} / </>
                          )}
                          最終更新: {new Date(provision.updatedAt).toLocaleString("ja-JP")}
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
                        onClick={() => handleEdit(provision.id)}
                        className="p-2 rounded hover:bg-gray-100"
                        aria-label="情報提供書を編集"
                        title="編集"
                      >
                        <Pencil size={14} style={{ color: "var(--text-muted)" }} />
                      </button>
                      <button
                        onClick={() => handleDelete(provision.id)}
                        className="btn-delete"
                        aria-label="情報提供書を削除"
                        title="削除"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="p-5 space-y-4 animate-fade-in" style={{ background: "var(--bg-tertiary)" }}>
                      <div className="text-xs space-y-1" style={{ color: "var(--text-muted)" }}>
                        {provision.aiModel && (
                          <div>
                            AI: {provision.aiModel} / {provision.aiPromptVersion ?? ""}
                          </div>
                        )}
                        {provision.monthlyVisitMonth && (
                          <div>
                            訪問: {provision.monthlyVisitMonth}（
                            {provision.monthlyVisitDays ?? "-"}日 / {provision.monthlyVisitCount ?? "-"}回）
                          </div>
                        )}
                      </div>

                      {fields.map((field) => {
                        const value = provision[field as keyof InfoProvision] as string | undefined;
                        const key = `${provision.id}-${field}`;
                        const label = FIELD_LABEL_LIST[field as string] ?? field;
                        return value?.trim() ? (
                          <div key={key} className="py-2" style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
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
                        ) : null;
                      })}
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
