"use client";

/**
 * 訪問看護月次報告書 共通フォームコンポーネント
 *
 * モード:
 *   - mode="new"  : 新規作成
 *   - mode="edit" : 既存報告書の編集（initialReport を渡す）
 *
 * フロー:
 *   1. 様式選択（通常 / 精神科）
 *   2. 対象月選択 → 期間内SOAP自動取得
 *   3. 看護師手入力（Barthel・自立度・GAF・衛生材料）
 *   4. AI生成（Haiku 4.5）→ 病状経過 / 看護内容 / 家族 / 特記の4欄ドラフト
 *   5. 看護師レビュー・編集 → 項目別コピー → 保存
 */

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  saveVisitReport,
  getRecordsByYearMonth,
  getNursingContents,
  getActiveNursingCarePlan,
  type Patient,
  type VisitReport,
  type VisitReportType,
  type SoapRecord,
  type DailyLifeLevel,
  type DementiaLevel,
  type BarthelIndex,
  type RehabAttachment,
  type HygieneMaterial,
  type HygieneMaterialItem,
  type VisitCalendarEntry,
  type VisitCalendarSymbol,
  issueToDisplayText,
} from "@/lib/storage";
import {
  AlertTriangle,
  Sparkles,
  Save,
  Copy,
  Loader2,
  FileEdit,
  Stethoscope,
  Plus,
  Trash2,
  CalendarDays,
} from "lucide-react";

// 選択肢
const REPORT_TYPES: { value: VisitReportType; label: string; tag: string }[] = [
  { value: "normal", label: "通常（別紙様式2）", tag: "通常" },
  { value: "psychiatric", label: "精神科（別紙様式4）", tag: "精神科" },
];

const DAILY_LIFE_LEVELS: DailyLifeLevel[] = ["J1", "J2", "A1", "A2", "B1", "B2", "C1", "C2"];
const DEMENTIA_LEVELS: DementiaLevel[] = ["自立", "Ⅰ", "Ⅱa", "Ⅱb", "Ⅲa", "Ⅲb", "Ⅳ", "M"];

const BARTHEL_ITEMS: { key: keyof BarthelIndex; label: string; options: number[] }[] = [
  { key: "feeding",  label: "食事",                       options: [0, 5, 10] },
  { key: "transfer", label: "移乗（車椅子⇔ベッド）",     options: [0, 5, 10, 15] },
  { key: "grooming", label: "整容",                       options: [0, 5] },
  { key: "toilet",   label: "トイレ動作",                 options: [0, 5, 10] },
  { key: "bathing",  label: "入浴",                       options: [0, 5] },
  { key: "walking",  label: "平地歩行",                   options: [0, 5, 10, 15] },
  { key: "stairs",   label: "階段昇降",                   options: [0, 5, 10] },
  { key: "dressing", label: "更衣",                       options: [0, 5, 10] },
  { key: "bowel",    label: "排便コントロール",           options: [0, 5, 10] },
  { key: "bladder",  label: "排尿コントロール",           options: [0, 5, 10] },
];

const HYGIENE_STATUSES: HygieneMaterialItem["status"][] = ["適切", "不足", "過剰", "変更検討"];

const VISIT_SYMBOLS: { value: VisitCalendarSymbol; label: string; description: string }[] = [
  { value: "○", label: "○", description: "看護師訪問" },
  { value: "◇", label: "◇", description: "PT/OT/ST 訪問" },
  { value: "△", label: "△", description: "特別指示書" },
];

export interface VisitReportFormProps {
  patient: Patient;
  mode: "new" | "edit";
  initialReport?: VisitReport;
}

interface AiGenerateResponse {
  disease_progress?: string;
  nursing_content?: string;
  family_care?: string;
  special_notes?: string;
  _ai_meta?: { model: string; prompt_version: string; generated_at: string };
  error?: string;
}

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function previousYearMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function VisitReportForm({ patient, mode, initialReport }: VisitReportFormProps) {
  const router = useRouter();

  // 基本情報
  const [reportType, setReportType] = useState<VisitReportType>(initialReport?.reportType ?? "normal");
  const [targetMonth, setTargetMonth] = useState<string>(initialReport?.targetMonth ?? previousYearMonth());
  const [authorName, setAuthorName] = useState(initialReport?.authorName ?? "");
  const [authorTitle, setAuthorTitle] = useState(initialReport?.authorTitle ?? "看護師");

  // 期間内SOAP
  const [periodRecords, setPeriodRecords] = useState<SoapRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);

  // ケア内容・有効計画書
  const [nursingContentItems, setNursingContentItems] = useState<string[]>([]);
  const [activePlanSummary, setActivePlanSummary] = useState<string>("");

  // 本文4欄
  const [diseaseProgress, setDiseaseProgress] = useState(initialReport?.diseaseProgress ?? "");
  const [nursingContent, setNursingContent] = useState(initialReport?.nursingContent ?? "");
  const [familyCare, setFamilyCare] = useState(initialReport?.familyCare ?? "");
  const [specialNotes, setSpecialNotes] = useState(initialReport?.specialNotes ?? "");

  // GAF（精神科）
  const [gafScore, setGafScore] = useState<string>(
    initialReport?.gafScore !== undefined ? String(initialReport.gafScore) : ""
  );
  const [gafJudgeDate, setGafJudgeDate] = useState(initialReport?.gafJudgeDate ?? "");
  const [gafUnavailable, setGafUnavailable] = useState(initialReport?.gafUnavailable ?? false);

  // リハ別添（通常）
  const [hasRehab, setHasRehab] = useState(!!initialReport?.rehabAttachment);
  const [rehabDailyLifeLevel, setRehabDailyLifeLevel] = useState<DailyLifeLevel | "">(
    initialReport?.rehabAttachment?.dailyLifeLevel ?? ""
  );
  const [rehabDementiaLevel, setRehabDementiaLevel] = useState<DementiaLevel | "">(
    initialReport?.rehabAttachment?.dementiaLevel ?? ""
  );
  const [barthel, setBarthel] = useState<BarthelIndex>(initialReport?.rehabAttachment?.barthelIndex ?? {});
  const [rehabCommunication, setRehabCommunication] = useState(
    initialReport?.rehabAttachment?.communication ?? ""
  );

  const barthelTotal = useMemo(
    () => BARTHEL_ITEMS.reduce((sum, item) => sum + (barthel[item.key] ?? 0), 0),
    [barthel]
  );

  // 衛生材料
  const [hygieneItems, setHygieneItems] = useState<HygieneMaterialItem[]>(
    initialReport?.hygieneMaterial?.items ?? []
  );
  const [hygieneRequest, setHygieneRequest] = useState(
    initialReport?.hygieneMaterial?.requestToDoctor ?? ""
  );

  // 訪問日暦
  const [visitCalendar, setVisitCalendar] = useState<VisitCalendarEntry[]>(
    initialReport?.visitCalendar ?? []
  );
  // 初回ロード時のみ保存済みの訪問日暦を尊重し、対象月の変更時は作り直す
  const visitCalendarInitialLoad = useRef(true);

  // AI生成
  const [generating, setGenerating] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiModel, setAiModel] = useState<string | undefined>(initialReport?.aiModel);
  const [aiPromptVersion, setAiPromptVersion] = useState<string | undefined>(initialReport?.aiPromptVersion);
  const [aiGeneratedAt, setAiGeneratedAt] = useState<string | undefined>(initialReport?.aiGeneratedAt);

  // 保存
  const [saving, setSaving] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // 対象月変更時にSOAPと訪問日暦を取得
  useEffect(() => {
    if (!targetMonth) return;
    const [y, m] = targetMonth.split("-").map(Number);
    if (!y || !m) return;
    setRecordsLoading(true);
    (async () => {
      const records = await getRecordsByYearMonth(patient.id, y, m);
      setPeriodRecords(records);

      // 初回ロードで保存済みの訪問日暦があればそれを尊重。
      // それ以外（対象月の変更時・新規作成時）は、選択中の月のSOAPから訪問日暦を作り直す。
      const keepSaved = visitCalendarInitialLoad.current && (initialReport?.visitCalendar?.length ?? 0) > 0;
      if (!keepSaved) {
        const seen = new Set<string>();
        const auto: VisitCalendarEntry[] = [];
        for (const r of records) {
          if (r.visitDate && !seen.has(r.visitDate)) {
            seen.add(r.visitDate);
            auto.push({ date: r.visitDate, symbol: "○" });
          }
        }
        auto.sort((a, b) => a.date.localeCompare(b.date));
        setVisitCalendar(auto);
      }
      visitCalendarInitialLoad.current = false;
      setRecordsLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient.id, targetMonth]);

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

  function updateBarthel(key: keyof BarthelIndex, value: number) {
    setBarthel((prev) => ({ ...prev, [key]: value }));
  }

  function addHygieneItem() {
    setHygieneItems((prev) => [...prev, { name: "", quantity: "", status: "適切" }]);
  }
  function removeHygieneItem(idx: number) {
    setHygieneItems((prev) => prev.filter((_, i) => i !== idx));
  }
  function updateHygieneItem(idx: number, patch: Partial<HygieneMaterialItem>) {
    setHygieneItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function updateVisitSymbol(date: string, symbol: VisitCalendarSymbol) {
    setVisitCalendar((prev) => {
      const exists = prev.find((e) => e.date === date);
      const entry: VisitCalendarEntry = { date, symbol };
      if (exists) {
        return prev.map((e) => (e.date === date ? { ...e, symbol } : e));
      }
      return [...prev, entry].sort((a, b) => a.date.localeCompare(b.date));
    });
  }
  function removeVisitDate(date: string) {
    setVisitCalendar((prev) => prev.filter((e) => e.date !== date));
  }
  function addVisitDateManual() {
    const today = `${targetMonth}-15`;
    if (visitCalendar.find((e) => e.date === today)) return;
    const entry: VisitCalendarEntry = { date: today, symbol: "○" };
    setVisitCalendar((prev) => [...prev, entry].sort((a, b) => a.date.localeCompare(b.date)));
  }

  async function handleGenerate() {
    if (periodRecords.length === 0) {
      alert("対象月のSOAP記録がありません。記録を作成してから報告書を生成してください。");
      return;
    }
    setGenerating(true);
    setAiError("");
    try {
      const res = await fetch("/api/visit-report/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportType,
          targetMonth,
          patient: { age: patient.age, diagnosis: patient.diagnosis, careLevel: patient.careLevel },
          periodSoapRecords: periodRecords.map((r) => ({
            visitDate: r.visitDate,
            S: r.S, O: r.O, A: r.A, P: r.P,
          })),
          nursingContentItems,
          activePlanSummary,
        }),
      });
      const data: AiGenerateResponse = await res.json();
      if (!res.ok) throw new Error(data.error || "AI生成に失敗しました");
      setDiseaseProgress(data.disease_progress ?? "");
      setNursingContent(data.nursing_content ?? "");
      setFamilyCare(data.family_care ?? "");
      setSpecialNotes(data.special_notes ?? "");
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
    if (!targetMonth || !reportType) {
      alert("様式と対象月を選択してください");
      return;
    }
    if (isDraft) setSavingDraft(true);
    else setSaving(true);
    setSaveError("");
    try {
      const rehabAttachment: RehabAttachment | undefined = hasRehab
        ? {
            dailyLifeLevel: rehabDailyLifeLevel || undefined,
            dementiaLevel: rehabDementiaLevel || undefined,
            barthelIndex: barthel,
            barthelTotal,
            communication: rehabCommunication || undefined,
          }
        : undefined;

      const hygieneMaterial: HygieneMaterial | undefined =
        hygieneItems.length > 0 || hygieneRequest
          ? { items: hygieneItems, requestToDoctor: hygieneRequest || undefined }
          : undefined;

      const saved = await saveVisitReport({
        id: mode === "edit" ? initialReport?.id : undefined,
        patientId: patient.id,
        reportType,
        targetMonth,
        isDraft,
        authorName: authorName || undefined,
        authorTitle: authorTitle || undefined,
        diseaseProgress: diseaseProgress || undefined,
        nursingContent: nursingContent || undefined,
        familyCare: familyCare || undefined,
        specialNotes: specialNotes || undefined,
        hygieneMaterial,
        visitCalendar,
        rehabAttachment,
        gafScore: gafScore !== "" ? Number(gafScore) : undefined,
        gafJudgeDate: gafJudgeDate || undefined,
        gafUnavailable,
        aiModel,
        aiPromptVersion,
        aiGeneratedAt,
      });
      if (!saved) throw new Error("保存に失敗しました");
      router.push(`/patients/${patient.id}/visit-reports`);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "保存中にエラーが発生しました");
    } finally {
      setSaving(false);
      setSavingDraft(false);
    }
  }

  function handleCopy(key: string, text: string) {
    if (!text.trim()) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  const hasAnyDraft =
    diseaseProgress.trim() || nursingContent.trim() || familyCare.trim() || specialNotes.trim();
  const isPsych = reportType === "psychiatric";

  return (
    <main className="max-w-2xl mx-auto px-4 py-6 relative z-[1] space-y-6">
      {mode === "edit" && (
        <section className="card p-4" style={{ background: "rgba(245, 158, 11, 0.08)", borderLeft: "4px solid #F59E0B" }}>
          <div className="flex gap-2 items-start">
            <FileEdit size={18} style={{ color: "#D97706", flexShrink: 0, marginTop: 2 }} />
            <div className="text-sm">
              <p className="font-semibold mb-1" style={{ color: "#B45309" }}>既存報告書を編集中</p>
              <p style={{ color: "var(--text-secondary)" }}>
                {initialReport?.isDraft ? "下書きを編集しています。" : "確定済みの報告書を編集しています。"}
                保存すると上書きされます。
              </p>
            </div>
          </div>
        </section>
      )}

      <section className="card p-4" style={{ background: "rgba(255, 193, 7, 0.08)", borderLeft: "4px solid #FFC107" }}>
        <div className="flex gap-2 items-start">
          <AlertTriangle size={18} style={{ color: "#F57C00", flexShrink: 0, marginTop: 2 }} />
          <div className="text-sm">
            <p className="font-semibold mb-1" style={{ color: "#E65100" }}>看護師判定が必要な項目</p>
            <p style={{ color: "var(--text-secondary)" }}>
              <strong>GAF点数（精神科）・Barthel点数・自立度・衛生材料の判断</strong> はAIが行わず、看護師が手入力します。
              本文4欄はAI下書き → 看護師確認・修正してください。
            </p>
          </div>
        </div>
      </section>

      {/* 基本情報 */}
      <section className="card p-5 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          <Stethoscope size={14} className="inline mr-1" />
          基本情報
        </h2>

        <div>
          <label className="block text-xs mb-2" style={{ color: "var(--text-muted)" }}>報告書様式 <span className="text-red-500">*</span></label>
          <div className="flex gap-2 flex-wrap">
            {REPORT_TYPES.map((rt) => (
              <button
                key={rt.value}
                type="button"
                onClick={() => setReportType(rt.value)}
                className={`px-4 py-2 text-sm rounded-lg border transition ${
                  reportType === rt.value ? "bg-blue-500 text-white border-blue-500" : "bg-white hover:bg-gray-50"
                }`}
                style={{ borderColor: reportType === rt.value ? undefined : "rgba(0,0,0,0.1)" }}
              >
                {rt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>対象月 <span className="text-red-500">*</span></label>
            <input
              type="month"
              value={targetMonth}
              onChange={(e) => setTargetMonth(e.target.value)}
              max={currentYearMonth()}
              className="w-full px-3 py-2 border rounded-lg text-sm"
              style={{ borderColor: "rgba(0,0,0,0.1)" }}
            />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>記入看護師名</label>
            <input
              type="text"
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              placeholder="例: 平田 花子"
              className="w-full px-3 py-2 border rounded-lg text-sm"
              style={{ borderColor: "rgba(0,0,0,0.1)" }}
            />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>肩書き</label>
            <input
              type="text"
              value={authorTitle}
              onChange={(e) => setAuthorTitle(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm"
              style={{ borderColor: "rgba(0,0,0,0.1)" }}
            />
          </div>
        </div>

        <div className="text-xs px-3 py-2 rounded" style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}>
          {recordsLoading
            ? "対象月のSOAPを読込中..."
            : `対象月のSOAP記録: ${periodRecords.length}件 ${periodRecords.length === 0 ? "（記録なし）" : ""}`}
        </div>
      </section>

      {/* 訪問日暦 */}
      <section className="card p-5 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          <CalendarDays size={14} className="inline mr-1" />
          訪問日暦（○=看護師、◇=PT/OT/ST、△=特別指示書）
        </h2>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          SOAPに登録された日付は自動的に「○（看護師訪問）」として追加されます。リハ訪問・特別指示書訪問は記号を変更してください。
        </p>
        {visitCalendar.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>訪問日が登録されていません。</p>
        ) : (
          <div className="space-y-2">
            {visitCalendar.map((entry) => (
              <div key={entry.date} className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-mono w-28" style={{ color: "var(--text-secondary)" }}>{entry.date}</span>
                <div className="flex gap-1">
                  {VISIT_SYMBOLS.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => updateVisitSymbol(entry.date, s.value)}
                      className={`px-3 py-1 text-sm rounded border transition ${
                        entry.symbol === s.value ? "bg-blue-500 text-white border-blue-500" : "bg-white hover:bg-gray-50"
                      }`}
                      style={{ borderColor: entry.symbol === s.value ? undefined : "rgba(0,0,0,0.1)" }}
                      title={s.description}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => removeVisitDate(entry.date)}
                  className="text-xs text-red-600 hover:bg-red-50 p-1 rounded"
                  aria-label="削除"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={addVisitDateManual}
          className="btn-outline text-xs"
        >
          <Plus size={14} />
          訪問日を手動追加
        </button>
      </section>

      {/* GAF（精神科） */}
      {isPsych && (
        <section className="card p-5 space-y-3" style={{ borderLeft: "4px solid #FFC107" }}>
          <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            GAF尺度 <span className="ml-2 text-xs font-normal" style={{ color: "#E65100" }}>（看護師判定・AI禁止）</span>
          </h2>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            2024年改定で精神科訪問看護報告書はGAF記載が必須化。月の初日訪問時に判定し、直近1週間で最も症状が悪かったエピソードで評価。
          </p>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={gafUnavailable}
              onChange={(e) => setGafUnavailable(e.target.checked)}
              id="gaf-unavailable"
            />
            <label htmlFor="gaf-unavailable" className="text-sm" style={{ color: "var(--text-secondary)" }}>
              家族のみ訪問でGAF判定不可
            </label>
          </div>
          {!gafUnavailable && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>GAF点数（0-100）</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={gafScore}
                  onChange={(e) => setGafScore(e.target.value)}
                  placeholder="例: 55"
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                  style={{ borderColor: "rgba(0,0,0,0.1)" }}
                />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>判定日（月初日訪問日）</label>
                <input
                  type="date"
                  value={gafJudgeDate}
                  onChange={(e) => setGafJudgeDate(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                  style={{ borderColor: "rgba(0,0,0,0.1)" }}
                />
              </div>
            </div>
          )}
        </section>
      )}

      {/* リハ別添（通常） */}
      {!isPsych && (
        <section className="card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
              リハ別添 <span className="ml-2 text-xs font-normal" style={{ color: "var(--text-muted)" }}>（PT/OT/ST訪問時のみ）</span>
            </h2>
            <button
              type="button"
              onClick={() => setHasRehab(!hasRehab)}
              className={`px-3 py-1 text-xs rounded-lg border ${
                hasRehab ? "bg-blue-500 text-white border-blue-500" : "bg-white hover:bg-gray-50"
              }`}
              style={{ borderColor: hasRehab ? undefined : "rgba(0,0,0,0.1)" }}
            >
              {hasRehab ? "別添あり" : "別添なし"}
            </button>
          </div>
          {hasRehab && (
            <div className="space-y-4 pt-2">
              <p className="text-xs" style={{ color: "#E65100" }}>
                ⚠ 自立度・認知症自立度・Barthel点数は <strong>看護師判定（AI禁止）</strong>
              </p>

              <div>
                <label className="block text-xs mb-2" style={{ color: "var(--text-muted)" }}>障害高齢者の日常生活自立度</label>
                <div className="flex flex-wrap gap-2">
                  {DAILY_LIFE_LEVELS.map((lv) => (
                    <button
                      key={lv}
                      type="button"
                      onClick={() => setRehabDailyLifeLevel(rehabDailyLifeLevel === lv ? "" : lv)}
                      className={`px-3 py-1 text-xs rounded-lg border ${
                        rehabDailyLifeLevel === lv ? "bg-blue-500 text-white border-blue-500" : "bg-white hover:bg-gray-50"
                      }`}
                      style={{ borderColor: rehabDailyLifeLevel === lv ? undefined : "rgba(0,0,0,0.1)" }}
                    >
                      {lv}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs mb-2" style={{ color: "var(--text-muted)" }}>認知症高齢者の日常生活自立度</label>
                <div className="flex flex-wrap gap-2">
                  {DEMENTIA_LEVELS.map((lv) => (
                    <button
                      key={lv}
                      type="button"
                      onClick={() => setRehabDementiaLevel(rehabDementiaLevel === lv ? "" : lv)}
                      className={`px-3 py-1 text-xs rounded-lg border ${
                        rehabDementiaLevel === lv ? "bg-blue-500 text-white border-blue-500" : "bg-white hover:bg-gray-50"
                      }`}
                      style={{ borderColor: rehabDementiaLevel === lv ? undefined : "rgba(0,0,0,0.1)" }}
                    >
                      {lv}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs mb-2" style={{ color: "var(--text-muted)" }}>
                  Barthel Index（10項目・100点満点）
                  <span className="ml-2 font-mono" style={{ color: "var(--accent-cyan)" }}>合計: {barthelTotal}点</span>
                </label>
                <div className="space-y-2">
                  {BARTHEL_ITEMS.map((item) => (
                    <div key={item.key} className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs w-32" style={{ color: "var(--text-secondary)" }}>{item.label}</span>
                      <div className="flex gap-1">
                        {item.options.map((v) => (
                          <button
                            key={v}
                            type="button"
                            onClick={() => updateBarthel(item.key, v)}
                            className={`px-2.5 py-1 text-xs rounded border ${
                              barthel[item.key] === v ? "bg-blue-500 text-white border-blue-500" : "bg-white hover:bg-gray-50"
                            }`}
                            style={{ borderColor: barthel[item.key] === v ? undefined : "rgba(0,0,0,0.1)" }}
                          >
                            {v}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
                  目安: 85点以上=自立 / 60点=部分自立 / 40点=大部分介助 / 0点=全介助
                </p>
              </div>

              <div>
                <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>コミュニケーション能力</label>
                <textarea
                  value={rehabCommunication}
                  onChange={(e) => setRehabCommunication(e.target.value)}
                  rows={3}
                  maxLength={3000}
                  placeholder="意思疎通の状況、難聴・構音障害・失語の有無等を記述"
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                  style={{ borderColor: "rgba(0,0,0,0.1)" }}
                />
              </div>
            </div>
          )}
        </section>
      )}

      {/* AI生成ボタン */}
      <section className="space-y-3">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={periodRecords.length === 0 || generating}
          className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {generating ? (
            <>
              <Loader2 size={20} className="animate-spin" />
              AI生成中...（最大90秒）
            </>
          ) : (
            <>
              <Sparkles size={20} />
              {hasAnyDraft ? "AIで再生成する" : "AIで報告書ドラフトを生成"}
            </>
          )}
        </button>
        {aiError && (
          <div className="p-3 rounded-lg text-sm" style={{ background: "rgba(239, 68, 68, 0.1)", color: "#B91C1C" }}>
            ⚠ {aiError}
          </div>
        )}
        {periodRecords.length === 0 && (
          <p className="text-xs text-center" style={{ color: "var(--text-muted)" }}>
            ※ 対象月のSOAP記録がありません
          </p>
        )}
      </section>

      {/* AIドラフト */}
      <section id="ai-draft" className="space-y-4" style={{ scrollMarginTop: "80px" }}>
        {hasAnyDraft && (
          <div className="card p-4" style={{ background: "rgba(56, 189, 248, 0.08)", borderLeft: "4px solid #0284C7" }}>
            <div className="flex gap-2 items-start">
              <Sparkles size={18} style={{ color: "#0284C7", flexShrink: 0, marginTop: 2 }} />
              <div className="text-sm">
                <p className="font-semibold mb-1" style={{ color: "#0369A1" }}>
                  AIドラフト（※必ず看護師が確認・修正してください）
                </p>
                <p style={{ color: "var(--text-secondary)" }}>
                  各項目は編集可能です。カイポケ等への転記用に項目別コピーボタンを用意しています。
                </p>
                {aiModel && (
                  <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                    モデル: {aiModel} / プロンプト: {aiPromptVersion}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {[
          { key: "disease_progress", label: "病状の経過", value: diseaseProgress, setter: setDiseaseProgress, max: 3000 },
          { key: "nursing_content", label: "看護・リハの内容", value: nursingContent, setter: setNursingContent, max: 3000 },
          {
            key: "family_care",
            label: isPsych ? "家族等との関係" : "家庭での介護の状況",
            value: familyCare,
            setter: setFamilyCare,
            max: 3000,
          },
          { key: "special_notes", label: "特記すべき事項", value: specialNotes, setter: setSpecialNotes, max: 3000 },
        ].map(({ key, label, value, setter, max }) => (
          <div key={key} className="card p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{label}</h3>
              <button
                type="button"
                onClick={() => handleCopy(key, value)}
                disabled={!value.trim()}
                className={`btn-copy ${copiedKey === key ? "btn-copy-success" : ""} disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                <Copy size={14} />
                {copiedKey === key ? "コピー済！" : "コピー"}
              </button>
            </div>
            <textarea
              value={value}
              onChange={(e) => setter(e.target.value)}
              rows={key === "disease_progress" ? 12 : 8}
              maxLength={max}
              placeholder={hasAnyDraft ? "" : "AI生成または手入力で記述"}
              className="w-full px-3 py-2 border rounded-lg text-sm leading-relaxed"
              style={{ borderColor: "rgba(0,0,0,0.1)" }}
            />
            <div className="text-xs text-right" style={{ color: value.length > max * 0.9 ? "#DC2626" : "var(--text-muted)" }}>
              {value.length} / {max}字
            </div>
          </div>
        ))}
      </section>

      {/* 衛生材料（看護師手入力・AI禁止） */}
      <section className="card p-5 space-y-3" style={{ borderLeft: "4px solid #FFC107" }}>
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          衛生材料 <span className="ml-2 text-xs font-normal" style={{ color: "#E65100" }}>（看護師手入力・AI禁止）</span>
        </h2>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          使用量・過不足・変更必要性を記入。主治医への依頼根拠となります。
        </p>
        {hygieneItems.length > 0 && (
          <div className="space-y-2">
            {hygieneItems.map((item, idx) => (
              <div key={idx} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                <input
                  type="text"
                  value={item.name}
                  onChange={(e) => updateHygieneItem(idx, { name: e.target.value })}
                  placeholder="材料名（例: ガーゼ）"
                  className="sm:col-span-4 px-3 py-2 border rounded-lg text-sm"
                  style={{ borderColor: "rgba(0,0,0,0.1)" }}
                />
                <input
                  type="text"
                  value={item.quantity}
                  onChange={(e) => updateHygieneItem(idx, { quantity: e.target.value })}
                  placeholder="使用量（例: 1日3枚×30日）"
                  className="sm:col-span-5 px-3 py-2 border rounded-lg text-sm"
                  style={{ borderColor: "rgba(0,0,0,0.1)" }}
                />
                <select
                  value={item.status}
                  onChange={(e) => updateHygieneItem(idx, { status: e.target.value as HygieneMaterialItem["status"] })}
                  className="sm:col-span-2 px-2 py-2 border rounded-lg text-sm"
                  style={{ borderColor: "rgba(0,0,0,0.1)" }}
                >
                  {HYGIENE_STATUSES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => removeHygieneItem(idx)}
                  className="sm:col-span-1 text-red-600 hover:bg-red-50 p-2 rounded justify-self-end"
                  aria-label="削除"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        <button type="button" onClick={addHygieneItem} className="btn-outline text-xs">
          <Plus size={14} />
          衛生材料を追加
        </button>
        <div>
          <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>主治医への依頼事項</label>
          <textarea
            value={hygieneRequest}
            onChange={(e) => setHygieneRequest(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="例: ガーゼの増量を希望"
            className="w-full px-3 py-2 border rounded-lg text-sm"
            style={{ borderColor: "rgba(0,0,0,0.1)" }}
          />
        </div>
      </section>

      {/* 保存 */}
      <section className="space-y-3">
        <button
          type="button"
          onClick={() => doSave(true)}
          disabled={!targetMonth || savingDraft || saving}
          className="btn-outline w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {savingDraft ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              保存中...
            </>
          ) : (
            <>
              <FileEdit size={18} />
              下書き保存（後で再編集できます）
            </>
          )}
        </button>
        <button
          type="button"
          onClick={() => doSave(false)}
          disabled={!targetMonth || saving || savingDraft || !hasAnyDraft}
          className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? (
            <>
              <Loader2 size={20} className="animate-spin" />
              保存中...
            </>
          ) : (
            <>
              <Save size={20} />
              報告書を確定保存する
            </>
          )}
        </button>
        {!hasAnyDraft && (
          <p className="text-xs text-center" style={{ color: "var(--text-muted)" }}>
            ※ 確定保存は本文4欄のいずれかが入力されている時に有効になります
          </p>
        )}
        {saveError && (
          <div className="p-3 rounded-lg text-sm" style={{ background: "rgba(239, 68, 68, 0.1)", color: "#B91C1C" }}>
            ⚠ {saveError}
          </div>
        )}
      </section>
    </main>
  );
}
