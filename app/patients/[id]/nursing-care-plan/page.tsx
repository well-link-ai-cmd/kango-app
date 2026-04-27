"use client";

/**
 * 看護計画書 一覧ページ
 * 患者の過去の看護計画書を一覧表示。新規作成・複製・編集・削除への導線。
 */

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  getPatients,
  getNursingCarePlans,
  deleteNursingCarePlan,
  type Patient,
  type NursingCarePlan,
} from "@/lib/storage";
import {
  ArrowLeft,
  PlusCircle,
  ClipboardList,
  Trash2,
  ChevronDown,
  ChevronUp,
  Copy,
  Pencil,
  CopyPlus,
  CheckCircle2,
} from "lucide-react";

export default function NursingCarePlanListPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [patient, setPatient] = useState<Patient | null>(null);
  const [plans, setPlans] = useState<NursingCarePlan[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const p = (await getPatients()).find((p) => p.id === id) ?? null;
      setPatient(p);
      const ps = await getNursingCarePlans(id);
      setPlans(ps);
      setLoaded(true);
    })();
  }, [id]);

  async function handleDelete(planId: string) {
    if (!confirm("この計画書を削除しますか？")) return;
    await deleteNursingCarePlan(planId);
    const ps = await getNursingCarePlans(id);
    setPlans(ps);
  }

  function handleEdit(planId: string) {
    router.push(`/patients/${id}/nursing-care-plan/${planId}/edit`);
  }

  function handleDuplicate(planId: string) {
    if (!confirm("この計画書を複製しますか？\n（評価欄・日付・作成者はリセットされます）")) return;
    router.push(`/patients/${id}/nursing-care-plan/new?copyFrom=${planId}`);
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

  // 「現在有効な計画書」= is_draft=false の最新
  const activePlan = plans.find((p) => !p.isDraft);

  return (
    <div className="min-h-screen relative z-[1]">
      <header className="app-header">
        <div className="app-header-inner">
          <Link href={`/patients/${id}`} className="header-back" aria-label="戻る">
            <ArrowLeft size={22} />
          </Link>
          <div className="flex-1">
            <h1>看護計画書</h1>
            <p className="subtitle">{patient.name} 様</p>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 relative z-[1]">
        {/* 新規作成ボタン */}
        <Link
          href={`/patients/${id}/nursing-care-plan/new`}
          className="btn-primary mb-6 animate-fade-in-up"
        >
          <PlusCircle size={22} />
          新しい看護計画書を作成する
        </Link>

        {/* 旧ケアプラン欄の移行バナー（過渡期） */}
        {patient.carePlan?.trim() && (
          <div className="card p-4 mb-4" style={{ background: "rgba(245, 158, 11, 0.05)", borderLeft: "3px solid rgb(245, 158, 11)" }}>
            <p className="text-sm font-semibold mb-2" style={{ color: "#B45309" }}>
              旧「ケアプラン・訪問方針」欄に内容があります
            </p>
            <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
              看護計画書を新規作成すると、旧欄の内容を参考情報としてAI生成に活用できます。
              この旧欄は将来的に廃止されるため、内容を看護計画書に移行することを推奨します。
            </p>
            <details className="text-xs" style={{ color: "var(--text-muted)" }}>
              <summary style={{ cursor: "pointer" }}>現在の旧欄の内容を表示</summary>
              <pre className="mt-2 p-2 whitespace-pre-wrap" style={{ background: "var(--bg-tertiary)", borderRadius: 4 }}>
                {patient.carePlan}
              </pre>
            </details>
          </div>
        )}

        {/* 計画書一覧 */}
        <h2 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text-muted)" }}>
          計画書一覧（{plans.length}件）
        </h2>

        {plans.length === 0 ? (
          <div className="empty-state">
            <ClipboardList size={36} style={{ color: "var(--text-muted)", opacity: 0.5 }} className="mx-auto mb-3" />
            <p>まだ看護計画書がありません</p>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              「新しい看護計画書を作成する」から始めてください
            </p>
          </div>
        ) : (
          <div className="space-y-3 stagger">
            {plans.map((plan) => {
              const isOpen = expandedId === plan.id;
              const isActive = activePlan?.id === plan.id;

              return (
                <div key={plan.id} className="card overflow-hidden">
                  <div className="flex items-center px-5 py-4 gap-2" style={{ borderBottom: isOpen ? "1px solid rgba(0,0,0,0.04)" : "none" }}>
                    <button
                      className="flex-1 flex items-center gap-3 text-left min-w-0"
                      onClick={() => setExpandedId(isOpen ? null : plan.id)}
                    >
                      <ClipboardList size={18} style={{ color: isOpen ? "var(--accent-cyan)" : "var(--text-muted)", flexShrink: 0 }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>
                            作成日: {plan.planDate}
                          </span>
                          {plan.isDraft ? (
                            <span className="text-xs px-2 py-0.5 rounded" style={{ background: "rgba(245, 158, 11, 0.15)", color: "#B45309" }}>
                              下書き
                            </span>
                          ) : isActive ? (
                            <span className="text-xs px-2 py-0.5 rounded flex items-center gap-1" style={{ background: "rgba(0, 200, 150, 0.15)", color: "#047857" }}>
                              <CheckCircle2 size={10} />
                              現在有効
                            </span>
                          ) : null}
                        </div>
                        <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                          {plan.planType}保険 / {plan.planTitle} / 課題{plan.issues.length}件
                          {plan.authorName && ` / ${plan.authorName}`}
                        </div>
                      </div>
                      {isOpen
                        ? <ChevronUp size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                        : <ChevronDown size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />}
                    </button>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleEdit(plan.id)}
                        className="p-2 rounded hover:bg-gray-100"
                        aria-label="計画書を編集"
                        title="編集"
                      >
                        <Pencil size={14} style={{ color: "var(--text-muted)" }} />
                      </button>
                      <button
                        onClick={() => handleDuplicate(plan.id)}
                        className="p-2 rounded hover:bg-gray-100"
                        aria-label="計画書を複製"
                        title="複製"
                      >
                        <CopyPlus size={14} style={{ color: "var(--text-muted)" }} />
                      </button>
                      <button
                        onClick={() => handleDelete(plan.id)}
                        className="btn-delete"
                        aria-label="計画書を削除"
                        title="削除"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="p-5 space-y-4 animate-fade-in" style={{ background: "var(--bg-tertiary)" }}>
                      {/* メタ情報 */}
                      <div className="text-xs space-y-1" style={{ color: "var(--text-muted)" }}>
                        {plan.authorName && <div>作成者: {plan.authorName} {plan.authorTitle && `(${plan.authorTitle})`}</div>}
                        {plan.author2Name && <div>作成者②: {plan.author2Name} {plan.author2Title && `(${plan.author2Title})`}</div>}
                        {plan.aiModel && (
                          <div>AI: {plan.aiModel} / {plan.aiPromptVersion}</div>
                        )}
                        <div>最終更新: {new Date(plan.updatedAt).toLocaleString("ja-JP")}</div>
                      </div>

                      {/* 目標 */}
                      {plan.nursingGoal?.trim() && (
                        <div className="py-2" style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>看護・リハビリの目標</h4>
                            <button
                              onClick={() => handleCopy(`${plan.id}-goal`, plan.nursingGoal!)}
                              className={`btn-copy ${copiedKey === `${plan.id}-goal` ? "btn-copy-success" : ""}`}
                            >
                              <Copy size={14} />
                              {copiedKey === `${plan.id}-goal` ? "コピー済！" : "コピー"}
                            </button>
                          </div>
                          <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: "var(--text-primary)" }}>
                            {plan.nursingGoal}
                          </p>
                        </div>
                      )}

                      {/* 課題リスト */}
                      {plan.issues.length > 0 && (
                        <div className="py-2" style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
                          <h4 className="text-sm font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
                            療養上の課題・支援内容（{plan.issues.length}件）
                          </h4>
                          <div className="space-y-3">
                            {plan.issues.map((iss) => (
                              <div key={iss.no} className="p-3 rounded" style={{ background: "var(--bg-secondary, #fff)" }}>
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
                                    No.{iss.no} {iss.date && `(${iss.date})`}
                                  </span>
                                  <button
                                    onClick={() => handleCopy(`${plan.id}-issue-${iss.no}`, iss.issue)}
                                    className={`btn-copy ${copiedKey === `${plan.id}-issue-${iss.no}` ? "btn-copy-success" : ""}`}
                                  >
                                    <Copy size={12} />
                                    {copiedKey === `${plan.id}-issue-${iss.no}` ? "コピー済！" : "コピー"}
                                  </button>
                                </div>
                                <p className="text-sm whitespace-pre-wrap" style={{ color: "var(--text-primary)" }}>
                                  {iss.issue}
                                </p>
                                {iss.evaluation?.trim() && (
                                  <div className="mt-2 pt-2" style={{ borderTop: "1px dashed rgba(0,0,0,0.1)" }}>
                                    <div className="flex items-center justify-between mb-1">
                                      <span className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
                                        評価
                                      </span>
                                      <button
                                        onClick={() => handleCopy(`${plan.id}-eval-${iss.no}`, iss.evaluation!)}
                                        className={`btn-copy ${copiedKey === `${plan.id}-eval-${iss.no}` ? "btn-copy-success" : ""}`}
                                      >
                                        <Copy size={12} />
                                        {copiedKey === `${plan.id}-eval-${iss.no}` ? "コピー済！" : "コピー"}
                                      </button>
                                    </div>
                                    <p className="text-xs whitespace-pre-wrap" style={{ color: "var(--text-primary)" }}>
                                      {iss.evaluation}
                                    </p>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 衛生材料 */}
                      {plan.hasSupplies && (
                        <div className="py-2" style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
                          <h4 className="text-sm font-semibold mb-2" style={{ color: "var(--text-primary)" }}>衛生材料</h4>
                          {plan.supplyProcedure && (
                            <div className="mb-2">
                              <div className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>処置の内容</div>
                              <p className="text-sm whitespace-pre-wrap">{plan.supplyProcedure}</p>
                            </div>
                          )}
                          {plan.supplyMaterials && (
                            <div className="mb-2">
                              <div className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>種類・サイズ</div>
                              <p className="text-sm whitespace-pre-wrap">{plan.supplyMaterials}</p>
                            </div>
                          )}
                          {plan.supplyQuantity && (
                            <div>
                              <div className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>必要量</div>
                              <p className="text-sm whitespace-pre-wrap">{plan.supplyQuantity}</p>
                            </div>
                          )}
                        </div>
                      )}

                      {/* 備考 */}
                      {plan.remarks?.trim() && (
                        <div className="py-2" style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
                          <div className="flex items-center justify-between mb-1">
                            <h4 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>備考</h4>
                            <button
                              onClick={() => handleCopy(`${plan.id}-remarks`, plan.remarks!)}
                              className={`btn-copy ${copiedKey === `${plan.id}-remarks` ? "btn-copy-success" : ""}`}
                            >
                              <Copy size={14} />
                              {copiedKey === `${plan.id}-remarks` ? "コピー済！" : "コピー"}
                            </button>
                          </div>
                          <p className="text-sm whitespace-pre-wrap" style={{ color: "var(--text-primary)" }}>
                            {plan.remarks}
                          </p>
                        </div>
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
