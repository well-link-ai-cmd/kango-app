"use client";

/**
 * 訪問看護情報提供書 共通フォームコンポーネント
 *
 * モード:
 *   - mode="new"  : 新規作成
 *   - mode="edit" : 既存提供書の編集（initialProvision を渡す）
 *
 * フロー:
 *   1. 宛先選択（市区町村 / 保健所長 / 学校 / 医療機関）
 *   2. 期間選択（既定: 直近1ヶ月）→ 期間内SOAP自動取得
 *   3. AI生成（Haiku 4.5・宛先別プロンプト）→ 各欄ドラフト
 *   4. 看護師レビュー・編集 → 項目別コピー → 保存
 */

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  saveInfoProvision,
  getRecords,
  getNursingContents,
  getActiveNursingCarePlan,
  issueToDisplayText,
  INFO_PROVISION_ADDRESSEE_LABEL,
  INFO_PROVISION_FIELDS,
  type Patient,
  type InfoProvision,
  type InfoProvisionAddressee,
  type SoapRecord,
} from "@/lib/storage";
import { Sparkles, Save, Copy, Loader2, FileEdit } from "lucide-react";

// ===================== フィールド定義 =====================
// `INFO_PROVISION_FIELDS` の各キーに対応するUI設定
type FieldKey = Exclude<keyof InfoProvision,
  | "id" | "patientId" | "createdAt" | "updatedAt"
  | "addresseeType" | "isDraft"
  | "targetPeriodStart" | "targetPeriodEnd" | "issuedDate"
  | "monthlyVisitMonth" | "monthlyVisitDays" | "monthlyVisitCount"
  | "aiModel" | "aiPromptVersion" | "aiGeneratedAt">;

const FIELD_LABEL: Record<FieldKey, string> = {
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

// camelCase ↔ snake_case 変換（API レスポンス用）
const FIELD_TO_SNAKE: Record<FieldKey, string> = {
  mainDisease: "main_disease",
  diseaseState: "disease_state",
  diseaseProgress: "disease_progress",
  pastHistory: "past_history",
  dailyLifeBasics: "daily_life_basics",
  medicationStatus: "medication_status",
  familyStatus: "family_status",
  familyCaregiverInfo: "family_caregiver_info",
  nursingProblems: "nursing_problems",
  nursingContent: "nursing_content",
  careMethodsContinuation: "care_methods_continuation",
  medicalCareMethods: "medical_care_methods",
  welfareServices: "welfare_services",
  otherNotes: "other_notes",
};

const ADDRESSEE_OPTIONS: InfoProvisionAddressee[] = [
  "municipality",
  "health_center",
  "school",
  "medical_institution",
];

export interface InfoProvisionFormProps {
  patient: Patient;
  mode: "new" | "edit";
  initialProvision?: InfoProvision;
}

function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function oneMonthAgoString(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function InfoProvisionForm({ patient, mode, initialProvision }: InfoProvisionFormProps) {
  const router = useRouter();

  // 基本情報
  const [addresseeType, setAddresseeType] = useState<InfoProvisionAddressee>(
    initialProvision?.addresseeType ?? "medical_institution"
  );
  const [periodStart, setPeriodStart] = useState<string>(initialProvision?.targetPeriodStart ?? oneMonthAgoString());
  const [periodEnd, setPeriodEnd] = useState<string>(initialProvision?.targetPeriodEnd ?? todayString());
  const [issuedDate, setIssuedDate] = useState<string>(initialProvision?.issuedDate ?? todayString());

  // 訪問日数（市区町村・保健所長・学校用、看護師手入力）
  const [monthlyVisitMonth, setMonthlyVisitMonth] = useState<string>(
    initialProvision?.monthlyVisitMonth ?? currentYearMonth()
  );
  const [monthlyVisitDays, setMonthlyVisitDays] = useState<string>(
    initialProvision?.monthlyVisitDays !== undefined ? String(initialProvision.monthlyVisitDays) : ""
  );
  const [monthlyVisitCount, setMonthlyVisitCount] = useState<string>(
    initialProvision?.monthlyVisitCount !== undefined ? String(initialProvision.monthlyVisitCount) : ""
  );

  // 本文（全フィールド分の state を1つの object で管理）
  const [bodyFields, setBodyFields] = useState<Record<FieldKey, string>>(() => {
    const init: Record<FieldKey, string> = {} as Record<FieldKey, string>;
    (Object.keys(FIELD_LABEL) as FieldKey[]).forEach((k) => {
      init[k] = (initialProvision?.[k] as string | undefined) ?? "";
    });
    return init;
  });

  function updateField(key: FieldKey, value: string) {
    setBodyFields((prev) => ({ ...prev, [key]: value }));
  }

  // 期間内SOAP
  const [periodRecords, setPeriodRecords] = useState<SoapRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);

  // ケア内容・有効計画書
  const [nursingContentItems, setNursingContentItems] = useState<string[]>([]);
  const [activePlanSummary, setActivePlanSummary] = useState<string>("");

  // AI生成
  const [generating, setGenerating] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiModel, setAiModel] = useState<string | undefined>(initialProvision?.aiModel);
  const [aiPromptVersion, setAiPromptVersion] = useState<string | undefined>(initialProvision?.aiPromptVersion);
  const [aiGeneratedAt, setAiGeneratedAt] = useState<string | undefined>(initialProvision?.aiGeneratedAt);

  // 保存
  const [saving, setSaving] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // 期間変更時にSOAP取得
  useEffect(() => {
    if (!periodStart || !periodEnd) return;
    setRecordsLoading(true);
    (async () => {
      const all = await getRecords(patient.id);
      const filtered = all
        .filter((r) => r.visitDate >= periodStart && r.visitDate <= periodEnd)
        .sort((a, b) => a.visitDate.localeCompare(b.visitDate));
      setPeriodRecords(filtered);
      setRecordsLoading(false);
    })();
  }, [patient.id, periodStart, periodEnd]);

  // 看護内容・有効計画書を読み込み
  useEffect(() => {
    (async () => {
      const nc = await getNursingContents(patient.id);
      const items = (nc?.items ?? []).filter((i) => i.isActive).map((i) => i.text);
      setNursingContentItems(items);

      const plan = await getActiveNursingCarePlan(patient.id);
      if (plan) {
        const goalLine = plan.nursingGoal ? `【目標】${plan.nursingGoal.slice(0, 200)}` : "";
        const issueLines = plan.issues
          .slice(0, 5)
          .map((iss) => `・${issueToDisplayText(iss).slice(0, 200)}`);
        setActivePlanSummary([goalLine, ...issueLines].filter(Boolean).join("\n"));
      }
    })();
  }, [patient.id]);

  // 宛先別の表示順
  const visibleFields = useMemo<FieldKey[]>(() => {
    const fields = INFO_PROVISION_FIELDS[addresseeType];
    // monthlyVisitMonth はメタなので除外（別UIで扱う）
    return fields.filter((f): f is FieldKey =>
      f !== "monthlyVisitMonth" && f !== "monthlyVisitDays" && f !== "monthlyVisitCount"
    );
  }, [addresseeType]);

  const showVisitMonthSection = useMemo(
    () => addresseeType === "municipality" || addresseeType === "health_center" || addresseeType === "school",
    [addresseeType]
  );

  async function handleGenerate() {
    if (periodRecords.length === 0) {
      alert("期間内のSOAP記録がありません。期間を見直してください。");
      return;
    }
    setGenerating(true);
    setAiError("");
    try {
      const res = await fetch("/api/info-provision/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          addresseeType,
          patient: { age: patient.age, diagnosis: patient.diagnosis, careLevel: patient.careLevel },
          periodStart,
          periodEnd,
          periodSoapRecords: periodRecords.map((r) => ({
            visitDate: r.visitDate,
            S: r.S, O: r.O, A: r.A, P: r.P,
          })),
          nursingContentItems,
          activePlanSummary,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "AI生成に失敗しました");

      // snake_case → camelCase で state 反映
      setBodyFields((prev) => {
        const next = { ...prev };
        (Object.keys(FIELD_TO_SNAKE) as FieldKey[]).forEach((k) => {
          const snake = FIELD_TO_SNAKE[k];
          if (typeof data[snake] === "string") next[k] = data[snake];
        });
        return next;
      });

      setAiModel(data._ai_meta?.model);
      setAiPromptVersion(data._ai_meta?.prompt_version);
      setAiGeneratedAt(data._ai_meta?.generated_at);

      setTimeout(() => {
        document.getElementById("ai-draft")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "AI生成中にエラーが発生しました");
    } finally {
      setGenerating(false);
    }
  }

  async function doSave(isDraft: boolean) {
    if (!addresseeType) {
      alert("宛先を選択してください");
      return;
    }
    if (isDraft) setSavingDraft(true);
    else setSaving(true);
    setSaveError("");
    try {
      const saved = await saveInfoProvision({
        id: mode === "edit" ? initialProvision?.id : undefined,
        patientId: patient.id,
        addresseeType,
        targetPeriodStart: periodStart || undefined,
        targetPeriodEnd: periodEnd || undefined,
        issuedDate: issuedDate || undefined,
        isDraft,
        // 本文
        ...bodyFields,
        // 訪問日数（該当宛先のみ）
        monthlyVisitMonth: showVisitMonthSection ? monthlyVisitMonth || undefined : undefined,
        monthlyVisitDays: showVisitMonthSection && monthlyVisitDays ? Number(monthlyVisitDays) : undefined,
        monthlyVisitCount: showVisitMonthSection && monthlyVisitCount ? Number(monthlyVisitCount) : undefined,
        aiModel,
        aiPromptVersion,
        aiGeneratedAt,
      });
      if (!saved) throw new Error("保存に失敗しました");
      router.push(`/patients/${patient.id}/info-provisions`);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "保存中にエラーが発生しました");
    } finally {
      if (isDraft) setSavingDraft(false);
      else setSaving(false);
    }
  }

  function handleCopy(key: string, text: string) {
    if (!text?.trim()) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-6 relative z-[1]">
      {/* 基本情報 */}
      <section className="card p-5 space-y-4 mb-4 animate-fade-in-up">
        <h2 className="font-semibold text-base" style={{ color: "var(--text-primary)" }}>基本情報</h2>

        <div>
          <label className="input-label">宛先 <span style={{ color: "var(--accent-error)" }}>*</span></label>
          <div className="grid grid-cols-2 gap-2">
            {ADDRESSEE_OPTIONS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAddresseeType(a)}
                className="text-sm px-3 py-2 rounded-lg border transition-colors"
                style={{
                  borderColor: addresseeType === a ? "var(--accent-cyan)" : "rgba(0,0,0,0.1)",
                  background: addresseeType === a ? "rgba(0, 200, 220, 0.08)" : "transparent",
                  color: addresseeType === a ? "var(--accent-cyan)" : "var(--text-secondary)",
                  fontWeight: addresseeType === a ? 600 : 400,
                }}
              >
                {INFO_PROVISION_ADDRESSEE_LABEL[a]}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="input-label">提供期間（開始）</label>
            <input type="date" className="input-field" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          </div>
          <div>
            <label className="input-label">提供期間（終了）</label>
            <input type="date" className="input-field" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="input-label">作成年月日</label>
          <input type="date" className="input-field" value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} />
        </div>

        {/* 訪問日数（市区町村・保健所長・学校のみ） */}
        {showVisitMonthSection && (
          <div className="space-y-2 p-3 rounded-lg" style={{ background: "var(--bg-tertiary)" }}>
            <p className="text-xs font-semibold" style={{ color: "var(--text-muted)" }}>1ヶ月当たりの訪問日数（看護師手入力）</p>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs" style={{ color: "var(--text-muted)" }}>サ提供月</label>
                <input
                  type="month"
                  className="input-field"
                  value={monthlyVisitMonth}
                  onChange={(e) => setMonthlyVisitMonth(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs" style={{ color: "var(--text-muted)" }}>訪問日数</label>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  className="input-field"
                  value={monthlyVisitDays}
                  onChange={(e) => setMonthlyVisitDays(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs" style={{ color: "var(--text-muted)" }}>訪問回数</label>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  className="input-field"
                  value={monthlyVisitCount}
                  onChange={(e) => setMonthlyVisitCount(e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        {/* 期間内SOAP件数 */}
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {recordsLoading ? "読み込み中..." : `期間内のSOAP記録: ${periodRecords.length}件`}
        </p>
      </section>

      {/* AI生成ボタン */}
      <button
        onClick={handleGenerate}
        disabled={generating || periodRecords.length === 0}
        className="btn-primary mb-4 animate-fade-in-up"
        style={{ opacity: generating || periodRecords.length === 0 ? 0.6 : 1 }}
      >
        {generating ? <Loader2 size={20} className="animate-spin" /> : <Sparkles size={20} />}
        {generating ? "AI生成中..." : "AIで本文ドラフトを生成"}
      </button>

      {aiError && <div className="alert-error mb-4">{aiError}</div>}

      {aiModel && aiGeneratedAt && (
        <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
          AI生成: {aiModel} / {new Date(aiGeneratedAt).toLocaleString("ja-JP")}
          {aiPromptVersion ? ` / ${aiPromptVersion}` : ""}
        </p>
      )}

      {/* 本文ドラフト */}
      <section id="ai-draft" className="space-y-4 animate-fade-in-up">
        {visibleFields.map((field) => {
          const value = bodyFields[field] ?? "";
          const charCount = value.length;
          return (
            <div key={field} className="card p-5 space-y-2">
              <div className="flex items-center justify-between">
                <label className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>
                  {FIELD_LABEL[field]}
                </label>
                <button
                  type="button"
                  onClick={() => handleCopy(field, value)}
                  className="text-xs px-2 py-1 rounded flex items-center gap-1"
                  style={{
                    background: copiedKey === field ? "rgba(0, 200, 150, 0.15)" : "var(--bg-tertiary)",
                    color: copiedKey === field ? "var(--accent-success)" : "var(--text-secondary)",
                  }}
                >
                  <Copy size={12} />
                  {copiedKey === field ? "コピー済" : "コピー"}
                </button>
              </div>
              <textarea
                className="input-field"
                rows={6}
                value={value}
                onChange={(e) => updateField(field, e.target.value)}
                placeholder={`${FIELD_LABEL[field]}（1000字以内）`}
                style={{ resize: "vertical", fontFamily: "inherit" }}
              />
              <div className="flex justify-end">
                <span className="text-xs" style={{ color: charCount > 1000 ? "var(--accent-error)" : "var(--text-muted)" }}>
                  {charCount}文字 / 1000文字
                </span>
              </div>
            </div>
          );
        })}
      </section>

      {/* 保存ボタン */}
      <div className="sticky bottom-4 z-10 mt-6 grid grid-cols-2 gap-3">
        <button
          onClick={() => doSave(true)}
          disabled={saving || savingDraft}
          className="btn-outline justify-center"
          style={{ opacity: saving || savingDraft ? 0.6 : 1 }}
        >
          {savingDraft ? <Loader2 size={18} className="animate-spin" /> : <FileEdit size={18} />}
          {savingDraft ? "保存中..." : "下書き保存"}
        </button>
        <button
          onClick={() => doSave(false)}
          disabled={saving || savingDraft}
          className="btn-primary justify-center"
          style={{ opacity: saving || savingDraft ? 0.6 : 1 }}
        >
          {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
          {saving ? "保存中..." : "確定保存"}
        </button>
      </div>

      {saveError && <div className="alert-error mt-4">{saveError}</div>}
    </main>
  );
}
