"use client";

/**
 * 褥瘡計画書 一覧ページ
 * 患者の過去の褥瘡計画書を一覧表示。新規作成への導線。
 */

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  getPatients,
  getPressureUlcerPlans,
  deletePressureUlcerPlan,
  type Patient,
  type PressureUlcerPlan,
} from "@/lib/storage";
import { ArrowLeft, PlusCircle, Shield, Trash2, ChevronDown, ChevronUp, Copy } from "lucide-react";

export default function PressureUlcerPlanListPage() {
  const { id } = useParams<{ id: string }>();

  const [patient, setPatient] = useState<Patient | null>(null);
  const [plans, setPlans] = useState<PressureUlcerPlan[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const p = (await getPatients()).find((p) => p.id === id) ?? null;
      setPatient(p);
      const ps = await getPressureUlcerPlans(id);
      setPlans(ps);
      setLoaded(true);
    })();
  }, [id]);

  async function handleDelete(planId: string) {
    if (!confirm("この計画書を削除しますか？")) return;
    await deletePressureUlcerPlan(planId);
    const ps = await getPressureUlcerPlans(id);
    setPlans(ps);
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
            <h1>褥瘡計画書</h1>
            <p className="subtitle">{patient.name} 様</p>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 relative z-[1]">
        {/* 新規作成ボタン */}
        <Link
          href={`/patients/${id}/pressure-ulcer-plan/new`}
          className="btn-primary mb-6 animate-fade-in-up"
        >
          <PlusCircle size={22} />
          新しい計画書を作成する
        </Link>

        {/* 計画書一覧 */}
        <h2 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text-muted)" }}>
          過去の計画書（{plans.length}件）
        </h2>

        {plans.length === 0 ? (
          <div className="empty-state">
            <Shield size={36} style={{ color: "var(--text-muted)", opacity: 0.5 }} className="mx-auto mb-3" />
            <p>まだ計画書がありません</p>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              「新しい計画書を作成する」から始めてください
            </p>
          </div>
        ) : (
          <div className="space-y-3 stagger">
            {plans.map((plan) => {
              const isOpen = expandedId === plan.id;
              const sections = [
                { key: `${plan.id}-bed`, label: "① 圧迫・ズレ力：ベッド上", value: plan.planBed },
                { key: `${plan.id}-chair`, label: "② 圧迫・ズレ力：イス上", value: plan.planChair },
                { key: `${plan.id}-skincare`, label: "③ スキンケア", value: plan.planSkincare },
                { key: `${plan.id}-nutrition`, label: "④ 栄養状態改善", value: plan.planNutrition },
                { key: `${plan.id}-rehab`, label: "⑤ リハビリテーション", value: plan.planRehab },
              ];

              return (
                <div key={plan.id} className="card overflow-hidden">
                  <div className="flex items-center px-5 py-4" style={{ borderBottom: isOpen ? "1px solid rgba(0,0,0,0.04)" : "none" }}>
                    <button
                      className="flex-1 flex items-center gap-3 text-left"
                      onClick={() => setExpandedId(isOpen ? null : plan.id)}
                    >
                      <Shield size={18} style={{ color: isOpen ? "var(--accent-cyan)" : "var(--text-muted)" }} />
                      <div className="flex-1">
                        <div className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>
                          作成日: {plan.planDate}
                        </div>
                        <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                          自立度: {plan.dailyLifeLevel ?? "-"} / OH: {plan.ohScaleScore ?? "-"}点
                          {plan.nextReviewDate && ` / 次回評価: ${plan.nextReviewDate}`}
                        </div>
                      </div>
                      {isOpen
                        ? <ChevronUp size={16} style={{ color: "var(--text-muted)" }} />
                        : <ChevronDown size={16} style={{ color: "var(--text-muted)" }} />}
                    </button>
                    <button
                      onClick={() => handleDelete(plan.id)}
                      className="btn-delete ml-2"
                      aria-label="計画書を削除"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {isOpen && (
                    <div className="p-5 space-y-4 animate-fade-in" style={{ background: "var(--bg-tertiary)" }}>
                      {/* メタ情報 */}
                      <div className="text-xs space-y-1" style={{ color: "var(--text-muted)" }}>
                        {plan.staffName && <div>記入看護師: {plan.staffName} {plan.staffTitle && `(${plan.staffTitle})`}</div>}
                        {plan.hasCurrentUlcer && (
                          <div>現在の褥瘡あり: {plan.currentLocations.join("、") || "-"}</div>
                        )}
                        {plan.aiModel && (
                          <div>AI: {plan.aiModel} / {plan.aiPromptVersion}</div>
                        )}
                        <div>最終更新: {new Date(plan.updatedAt).toLocaleString("ja-JP")}</div>
                      </div>

                      {/* 5軸 */}
                      {sections.map(({ key, label, value }) => (
                        value?.trim() ? (
                          <div key={key} className="py-2" style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{label}</h4>
                              <button
                                onClick={() => handleCopy(key, value)}
                                className={`btn-copy ${copiedKey === key ? "btn-copy-success" : ""}`}
                              >
                                <Copy size={14} />
                                {copiedKey === key ? "コピー済！" : "コピー"}
                              </button>
                            </div>
                            <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: "var(--text-primary)" }}>
                              {value}
                            </p>
                          </div>
                        ) : null
                      ))}

                      {plan.evaluationNotes && (
                        <div className="py-2" style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
                          <h4 className="text-sm font-semibold mb-1" style={{ color: "var(--text-primary)" }}>評価記録</h4>
                          <p className="text-sm whitespace-pre-wrap" style={{ color: "var(--text-primary)" }}>{plan.evaluationNotes}</p>
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
