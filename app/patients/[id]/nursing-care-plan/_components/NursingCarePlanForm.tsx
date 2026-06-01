"use client";

/**
 * 看護計画書 共通フォームコンポーネント
 *
 * new / edit の2モード + 複製（mode="new" + initialPlan + isCopy）に対応。
 * 手順書: docs/看護計画書_手順書.md
 *
 * AI責任分界:
 *  - 🤖 AI下書き可: 看護・リハビリの目標、療養上の課題、備考、評価欄（期間SOAPから）
 *  - 👤 看護師記入必須: 計画書タイプ、タイトル、衛生材料、作成者情報
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  saveNursingCarePlan,
  issueToDisplayText,
  issueToBodyText,
  parseBodyText,
  type NursingCarePlan,
  type NursingCarePlanType,
  type NursingCarePlanTitle,
  type NursingCarePlanIssue,
  type NursingCareIssueNanda,
  type NursingCareIssueFreeform,
  type NursingCareIssueFormat,
  type Patient,
  type SoapRecord,
} from "@/lib/storage";

function isNandaIssue(iss: NursingCarePlanIssue): iss is NursingCareIssueNanda {
  return iss.format === "nanda";
}
function isFreeformIssue(iss: NursingCarePlanIssue): iss is NursingCareIssueFreeform {
  return iss.format !== "nanda";
}
/** freeform issue の本文。NANDA時は空文字（freeform 専用UIで使用） */
function readIssueText(iss: NursingCarePlanIssue): string {
  return isFreeformIssue(iss) ? iss.issue : "";
}

/** suggest-labels API のレスポンス候補 */
interface LabelCandidate {
  label: string;
  rationale: string;
  priority: "high" | "medium" | "low";
  is_continuation: boolean;
}
import {
  Sparkles,
  Save,
  Copy,
  Loader2,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle2,
  CalendarDays,
  UserCircle2,
  FileEdit,
  Bot,
  User as UserIcon,
  ClipboardList,
  Target,
  Package,
  MessageSquare,
} from "lucide-react";

// ============================================================
// 選択肢定数
// ============================================================
const PLAN_TYPES: NursingCarePlanType[] = ["介護", "医療"];
const PLAN_TITLES: NursingCarePlanTitle[] = ["共通", "看護", "リハ"];

type EvalPeriodKey = "1m" | "3m" | "6m" | "12m" | "custom";
const EVAL_PERIOD_LABELS: Record<EvalPeriodKey, string> = {
  "1m": "1ヶ月",
  "3m": "3ヶ月",
  "6m": "6ヶ月（デフォルト）",
  "12m": "12ヶ月",
  custom: "カスタム",
};

// ============================================================
// プロップス
// ============================================================
export interface NursingCarePlanFormProps {
  patient: Patient;
  recentRecords: SoapRecord[];
  allRecords: SoapRecord[]; // 評価機能で使用（期間フィルタ対象）
  nursingContentItems: string[];
  mode: "new" | "edit";
  initialPlan?: NursingCarePlan;
  /** 複製モードかどうか */
  isCopy?: boolean;
}

// ============================================================
// フォーム本体
// ============================================================
export default function NursingCarePlanForm({
  patient,
  recentRecords,
  allRecords,
  nursingContentItems,
  mode,
  initialPlan,
  isCopy = false,
}: NursingCarePlanFormProps) {
  const router = useRouter();
  const copyInitial = isCopy && initialPlan;

  // ---- 基本情報 ----
  const [planDate, setPlanDate] = useState(
    copyInitial
      ? new Date().toISOString().slice(0, 10)
      : initialPlan?.planDate ?? new Date().toISOString().slice(0, 10)
  );
  const [planType, setPlanType] = useState<NursingCarePlanType>(initialPlan?.planType ?? "介護");
  const [planTitle, setPlanTitle] = useState<NursingCarePlanTitle>(initialPlan?.planTitle ?? "共通");

  // ---- 作成者 ----
  const [authorName, setAuthorName] = useState(copyInitial ? "" : initialPlan?.authorName ?? "");
  const [authorTitle, setAuthorTitle] = useState(copyInitial ? "看護師" : initialPlan?.authorTitle ?? "看護師");
  const [author2Name, setAuthor2Name] = useState(copyInitial ? "" : initialPlan?.author2Name ?? "");
  const [author2Title, setAuthor2Title] = useState(copyInitial ? "" : initialPlan?.author2Title ?? "");

  // ---- 看護・リハビリの目標（AI下書き可） ----
  const [nursingGoal, setNursingGoal] = useState(initialPlan?.nursingGoal ?? "");

  // ---- 課題の記述形式（NANDA / freeform） ----
  // 新規作成時は NANDA をデフォルト、編集時は既存値を尊重（既存データは freeform 互換）
  const [issueFormat, setIssueFormat] = useState<NursingCareIssueFormat>(
    initialPlan?.issueFormat ?? (mode === "new" ? "nanda" : "freeform")
  );

  // ---- 療養上の課題・支援内容 ----
  const [issues, setIssues] = useState<NursingCarePlanIssue[]>(
    initialPlan?.issues ?? []
  );

  // ---- 議事録（任意・AI生成時の参照ソース） ----
  const [conferenceMemo, setConferenceMemo] = useState(initialPlan?.conferenceMemo ?? "");

  // ---- ラベル候補提示（NANDAフロー Step 1） ----
  const [labelCandidates, setLabelCandidates] = useState<LabelCandidate[]>([]);
  const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set());
  const [customLabelInput, setCustomLabelInput] = useState("");
  const [suggestingLabels, setSuggestingLabels] = useState(false);
  const [suggestError, setSuggestError] = useState("");
  const [generatingIssues, setGeneratingIssues] = useState(false);
  const [generateIssuesError, setGenerateIssuesError] = useState("");

  // ---- コピペ取り込み ----
  const [pasteImportText, setPasteImportText] = useState("");
  const [showPasteImport, setShowPasteImport] = useState(false);

  // ---- 衛生材料（AI禁止・看護師手入力） ----
  const [hasSupplies, setHasSupplies] = useState(initialPlan?.hasSupplies ?? false);
  const [supplyProcedure, setSupplyProcedure] = useState(initialPlan?.supplyProcedure ?? "");
  const [supplyMaterials, setSupplyMaterials] = useState(initialPlan?.supplyMaterials ?? "");
  const [supplyQuantity, setSupplyQuantity] = useState(initialPlan?.supplyQuantity ?? "");

  // ---- 備考 ----
  const [remarks, setRemarks] = useState(initialPlan?.remarks ?? "");

  // ---- 下書き/確定フラグ ----
  const [isDraft, setIsDraft] = useState(initialPlan?.isDraft ?? true);

  // ---- AI生成 ----
  const [generating, setGenerating] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiMode, setAiMode] = useState<"from_scratch" | "refine">("from_scratch");
  const [aiMeta, setAiMeta] = useState<{ model: string; promptVersion: string; generatedAt: string } | null>(
    initialPlan?.aiModel
      ? { model: initialPlan.aiModel, promptVersion: initialPlan.aiPromptVersion ?? "", generatedAt: initialPlan.aiGeneratedAt ?? "" }
      : null
  );

  // ---- 評価AI ----
  const [evaluating, setEvaluating] = useState(false);
  const [evalError, setEvalError] = useState("");
  const [evalPeriod, setEvalPeriod] = useState<EvalPeriodKey>("6m");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState(new Date().toISOString().slice(0, 10));

  // ---- 保存 ----
  const [saving, setSaving] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // ============================================================
  // ハンドラ
  // ============================================================

  function nextIssueNo(): number {
    return issues.length > 0 ? Math.max(...issues.map((i) => i.no)) + 1 : 1;
  }

  /** freeform モード：空の自由文 issue を1行追加 */
  function handleAddIssue() {
    setIssues([
      ...issues,
      { no: nextIssueNo(), date: planDate, format: "freeform", issue: "", evaluation: "" },
    ]);
  }

  /** NANDAモード：空のラベル+OP/TP/EP issue を1行追加 */
  function handleAddNandaIssue() {
    setIssues([
      ...issues,
      {
        no: nextIssueNo(),
        date: planDate,
        format: "nanda",
        diagnosisLabel: "",
        op: [],
        tp: [],
        ep: [],
        evaluation: "",
      },
    ]);
  }

  function handleUpdateIssue(idx: number, patch: Partial<NursingCareIssueFreeform>) {
    setIssues(
      issues.map((iss, i) =>
        i === idx ? ({ ...iss, ...patch } as NursingCarePlanIssue) : iss
      )
    );
  }

  function handleUpdateNandaIssue(idx: number, patch: Partial<NursingCareIssueNanda>) {
    setIssues(
      issues.map((iss, i) =>
        i === idx ? ({ ...iss, ...patch } as NursingCarePlanIssue) : iss
      )
    );
  }

  function handleRemoveIssue(idx: number) {
    if (!confirm("この課題を削除しますか？")) return;
    setIssues(issues.filter((_, i) => i !== idx));
  }

  // ============================================================
  // NANDAフロー: 議事録 → ラベル候補提示 → 選択 → OP/TP/EP 一括生成
  // ============================================================

  async function handleSuggestLabels() {
    setSuggestingLabels(true);
    setSuggestError("");
    setLabelCandidates([]);
    setSelectedLabels(new Set());
    try {
      const res = await fetch("/api/nursing-care-plan/suggest-labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId: patient.id,
          patient: { age: patient.age, diagnosis: patient.diagnosis, careLevel: patient.careLevel },
          conferenceMemo: conferenceMemo.trim() || undefined,
          oldCarePlan: patient.carePlan,
          careManagerPlanImagePaths: patient.careManagerPlan?.images?.map((i) => i.path) ?? [],
          careManagerPlanText: patient.careManagerPlan?.text,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "ラベル候補の提示に失敗しました");
      setLabelCandidates(data.candidates ?? []);
      // 継続課題は最初からチェック済みにしておく（看護師が外すのは簡単）
      const initialSelected = new Set<string>(
        (data.candidates ?? [])
          .filter((c: LabelCandidate) => c.is_continuation)
          .map((c: LabelCandidate) => c.label)
      );
      setSelectedLabels(initialSelected);
    } catch (e) {
      setSuggestError(e instanceof Error ? e.message : "候補生成中にエラー");
    } finally {
      setSuggestingLabels(false);
    }
  }

  function toggleLabelSelection(label: string) {
    const next = new Set(selectedLabels);
    if (next.has(label)) next.delete(label);
    else next.add(label);
    setSelectedLabels(next);
  }

  function addCustomLabel() {
    const label = customLabelInput.trim();
    if (!label) return;
    const next = new Set(selectedLabels);
    next.add(label);
    setSelectedLabels(next);
    // 候補リストにも見える形で追加（rationale はユーザー追加と明記）
    setLabelCandidates([
      ...labelCandidates,
      { label, rationale: "（看護師が手動で追加）", priority: "medium", is_continuation: false },
    ]);
    setCustomLabelInput("");
  }

  async function handleGenerateIssuesFromLabels() {
    const labels = Array.from(selectedLabels);
    if (labels.length === 0) {
      setGenerateIssuesError("少なくとも1つのラベルを選択してください");
      return;
    }
    setGeneratingIssues(true);
    setGenerateIssuesError("");
    try {
      const res = await fetch("/api/nursing-care-plan/generate-issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId: patient.id,
          patient: { age: patient.age, diagnosis: patient.diagnosis, careLevel: patient.careLevel },
          labels,
          conferenceMemo: conferenceMemo.trim() || undefined,
          oldCarePlan: patient.carePlan,
          careManagerPlanImagePaths: patient.careManagerPlan?.images?.map((i) => i.path) ?? [],
          careManagerPlanText: patient.careManagerPlan?.text,
          nursingContentItems,
          planDate,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "OP/TP/EP生成に失敗しました");

      setNursingGoal(data.nursing_goal ?? "");

      // API から返った issues は既に diagnosisLabel/op/tp/ep が snake_case 由来。型変換を行う
      const newIssues: NursingCarePlanIssue[] = (data.issues ?? []).map(
        (
          i: {
            no: number;
            date: string;
            diagnosis_label: string;
            op: string[];
            tp: string[];
            ep: string[];
            ai_generated: boolean;
            ai_model: string;
            ai_generated_at: string;
          },
          idx: number
        ) => ({
          no: i.no ?? idx + 1,
          date: i.date ?? planDate,
          format: "nanda",
          diagnosisLabel: i.diagnosis_label,
          op: i.op ?? [],
          tp: i.tp ?? [],
          ep: i.ep ?? [],
          aiGenerated: i.ai_generated,
          aiModel: i.ai_model,
          aiGeneratedAt: i.ai_generated_at,
        } satisfies NursingCareIssueNanda)
      );
      setIssues(newIssues);
      if (data._ai_meta) {
        setAiMeta({
          model: data._ai_meta.model,
          promptVersion: data._ai_meta.prompt_version,
          generatedAt: data._ai_meta.generated_at,
        });
      }
      // 候補リストをクリア（生成完了したので）
      setLabelCandidates([]);
      setSelectedLabels(new Set());
    } catch (e) {
      setGenerateIssuesError(e instanceof Error ? e.message : "生成中にエラー");
    } finally {
      setGeneratingIssues(false);
    }
  }

  // ============================================================
  // コピペ取り込み: 既存計画書テキストを丸ごと freeform issue として追加
  // （AI整形なし。ユーザー要望通り）
  // ============================================================
  function handleImportPaste() {
    const text = pasteImportText.trim();
    if (!text) return;
    const now = new Date().toISOString();
    setIssues([
      ...issues,
      {
        no: nextIssueNo(),
        date: planDate,
        format: "freeform",
        issue: text,
        evaluation: "",
        imported: true,
        importedAt: now,
      },
    ]);
    setPasteImportText("");
    setShowPasteImport(false);
  }

  async function handleGenerateAi() {
    setGenerating(true);
    setAiError("");
    try {
      const res = await fetch("/api/nursing-care-plan/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient: {
            age: patient.age,
            diagnosis: patient.diagnosis,
            careLevel: patient.careLevel,
          },
          planDate,
          nursingContentItems,
          carePlan: patient.carePlan, // 過渡期の参考
          careManagerPlanImagePaths: patient.careManagerPlan?.images?.map((i) => i.path) ?? [],
          careManagerPlanText: patient.careManagerPlan?.text,
          recentSoapRecords: recentRecords.slice(0, 5).map((r) => ({
            visitDate: r.visitDate,
            S: r.S,
            O: r.O,
            A: r.A,
            P: r.P,
          })),
          mode: aiMode,
          existingGoal: aiMode === "refine" ? nursingGoal : undefined,
          existingIssues: aiMode === "refine" ? issues.map((i) => ({ no: i.no, issue: readIssueText(i) })) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "AI生成に失敗しました");

      setNursingGoal(data.nursing_goal ?? "");
      // 既存のevaluationを保持しつつissue列のみ更新
      const newIssues: NursingCarePlanIssue[] = (data.issues ?? []).map(
        (i: { no: number; date: string; issue: string }) => {
          const existing = issues.find((e) => e.no === i.no);
          return {
            no: i.no,
            date: i.date ?? planDate,
            format: "freeform",
            issue: i.issue,
            evaluation: existing?.evaluation ?? "",
            evaluatedAt: existing?.evaluatedAt,
          } satisfies NursingCareIssueFreeform;
        }
      );
      setIssues(newIssues);
      if (data.remarks) setRemarks(data.remarks);
      if (data._ai_meta) {
        setAiMeta({
          model: data._ai_meta.model,
          promptVersion: data._ai_meta.prompt_version,
          generatedAt: data._ai_meta.generated_at,
        });
      }
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "AI生成中にエラー");
    } finally {
      setGenerating(false);
    }
  }

  function getPeriodRange(): { start: string; end: string } {
    const today = new Date(customEnd || new Date().toISOString().slice(0, 10));
    if (evalPeriod === "custom") return { start: customStart, end: customEnd };
    const monthsMap: Record<string, number> = { "1m": 1, "3m": 3, "6m": 6, "12m": 12 };
    const months = monthsMap[evalPeriod] ?? 6;
    const start = new Date(today);
    start.setMonth(start.getMonth() - months);
    return {
      start: start.toISOString().slice(0, 10),
      end: today.toISOString().slice(0, 10),
    };
  }

  async function handleEvaluate() {
    if (issues.length === 0) {
      setEvalError("評価対象の課題がありません。先に課題を登録してください。");
      return;
    }
    // NANDA時は diagnosisLabel + OP/TP/EP を文字列化して評価APIに渡す
    const nonEmptyIssues = issues.filter((i) => issueToDisplayText(i).trim());
    if (nonEmptyIssues.length === 0) {
      setEvalError("課題内容が空です。先に課題を記入してください。");
      return;
    }

    const { start, end } = getPeriodRange();
    if (!start || !end) {
      setEvalError("期間を指定してください。");
      return;
    }

    const periodRecords = allRecords.filter(
      (r) => r.visitDate >= start && r.visitDate <= end
    );

    setEvaluating(true);
    setEvalError("");
    try {
      const res = await fetch("/api/nursing-care-plan/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient: {
            age: patient.age,
            diagnosis: patient.diagnosis,
            careLevel: patient.careLevel,
          },
          issues: nonEmptyIssues.map((i) => ({ no: i.no, issue: issueToDisplayText(i) })),
          periodStart: start,
          periodEnd: end,
          periodSoapRecords: periodRecords.map((r) => ({
            visitDate: r.visitDate,
            S: r.S,
            O: r.O,
            A: r.A,
            P: r.P,
          })),
          nursingContentItems,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "評価生成に失敗しました");

      const evaluations: Array<{ no: number; evaluation: string; evaluated_at: string }> = data.evaluations ?? [];
      setIssues(
        issues.map((iss) => {
          const ev = evaluations.find((e) => e.no === iss.no);
          return ev ? { ...iss, evaluation: ev.evaluation, evaluatedAt: ev.evaluated_at } : iss;
        })
      );
    } catch (e) {
      setEvalError(e instanceof Error ? e.message : "評価生成中にエラー");
    } finally {
      setEvaluating(false);
    }
  }

  async function handleSave(saveAsDraft: boolean) {
    if (saving) return;
    if (!saveAsDraft) {
      if (!nursingGoal.trim() && issues.length === 0) {
        if (!confirm("目標も課題も未記入ですが、確定保存しますか？")) return;
      }
    }

    setSaving(true);
    try {
      const saved = await saveNursingCarePlan({
        id: mode === "edit" ? initialPlan?.id : undefined,
        patientId: patient.id,
        planDate,
        planType,
        planTitle,
        isDraft: saveAsDraft,
        issueFormat,
        conferenceMemo: conferenceMemo.trim() || undefined,
        authorName: authorName.trim() || undefined,
        authorTitle: authorTitle.trim() || undefined,
        author2Name: author2Name.trim() || undefined,
        author2Title: author2Title.trim() || undefined,
        nursingGoal: nursingGoal.trim() || undefined,
        issues,
        hasSupplies,
        supplyProcedure: supplyProcedure.trim() || undefined,
        supplyMaterials: supplyMaterials.trim() || undefined,
        supplyQuantity: supplyQuantity.trim() || undefined,
        remarks: remarks.trim() || undefined,
        aiModel: aiMeta?.model,
        aiPromptVersion: aiMeta?.promptVersion,
        aiGeneratedAt: aiMeta?.generatedAt,
      });
      if (!saved) throw new Error("保存に失敗しました");
      setIsDraft(saveAsDraft);
      router.push(`/patients/${patient.id}/nursing-care-plan`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "保存エラー");
    } finally {
      setSaving(false);
    }
  }

  function handleCopy(key: string, text: string) {
    if (!text?.trim()) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  // ============================================================
  // レンダリング
  // ============================================================
  return (
    <main className="max-w-3xl mx-auto px-4 py-6 relative z-[1] space-y-4">
      {/* 基本情報 */}
      <section className="card p-5 space-y-4">
        <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
          <CalendarDays size={16} />
          基本情報
          <UserInputBadge />
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="input-label">作成年月日</label>
            <input
              type="date"
              className="input-field"
              value={planDate}
              onChange={(e) => setPlanDate(e.target.value)}
            />
          </div>
          <div>
            <label className="input-label">計画書タイプ</label>
            <select
              className="input-field"
              value={planType}
              onChange={(e) => setPlanType(e.target.value as NursingCarePlanType)}
            >
              {PLAN_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}保険
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="input-label">タイトル</label>
          <div className="flex gap-2">
            {PLAN_TITLES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setPlanTitle(t)}
                className={`btn-outline ${planTitle === t ? "btn-outline-active" : ""}`}
                style={
                  planTitle === t
                    ? { background: "var(--accent-cyan)", color: "#fff", borderColor: "var(--accent-cyan)" }
                    : undefined
                }
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* 作成者 */}
      <section className="card p-5 space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
          <UserCircle2 size={16} />
          作成者
          <UserInputBadge />
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="input-label">作成者①氏名</label>
            <input type="text" className="input-field" value={authorName} onChange={(e) => setAuthorName(e.target.value)} />
          </div>
          <div>
            <label className="input-label">職種①</label>
            <input type="text" className="input-field" value={authorTitle} onChange={(e) => setAuthorTitle(e.target.value)} placeholder="看護師" />
          </div>
          <div>
            <label className="input-label">作成者②氏名（任意）</label>
            <input type="text" className="input-field" value={author2Name} onChange={(e) => setAuthor2Name(e.target.value)} />
          </div>
          <div>
            <label className="input-label">職種②（任意）</label>
            <input type="text" className="input-field" value={author2Title} onChange={(e) => setAuthor2Title(e.target.value)} />
          </div>
        </div>
      </section>

      {/* 課題の記述形式（NANDA / freeform） */}
      <section className="card p-5 space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
          <ClipboardList size={16} />
          課題の記述形式
          <UserInputBadge />
        </h2>
        <div className="flex gap-3 text-sm">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="issueFormat"
              checked={issueFormat === "nanda"}
              onChange={() => setIssueFormat("nanda")}
            />
            <div>
              <div className="font-semibold">NANDA形式（推奨）</div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                課題ラベル + OP（観察）/ TP（ケア）/ EP（指導）の構造化
              </div>
            </div>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="issueFormat"
              checked={issueFormat === "freeform"}
              onChange={() => setIssueFormat("freeform")}
            />
            <div>
              <div className="font-semibold">自由記載</div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                自由文1ブロック（既存形式と同じ）
              </div>
            </div>
          </label>
        </div>
      </section>

      {/* 議事録（任意・NANDAフローのコンテキスト） */}
      <section className="card p-5 space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
          <MessageSquare size={16} />
          議事録（任意・推奨）
          <UserInputBadge />
        </h2>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          退院前カンファレンス・サービス担当者会議等の議事録を貼り付けると、AIによる課題抽出の精度が上がります。
          すでに利用中の方はSOAP記録が優先されるため、議事録は任意です。
        </p>
        <textarea
          rows={4}
          maxLength={3000}
          className="input-field text-sm"
          style={{ resize: "vertical", fontFamily: "inherit" }}
          value={conferenceMemo}
          onChange={(e) => setConferenceMemo(e.target.value)}
          placeholder="例：退院前カンファレンス（YYYY/MM/DD）&#10;参加者：主治医、病棟看護師、ご家族、当ステーション&#10;議題：退院後の在宅療養について&#10;・夜間覚醒が多く独居で不安強い&#10;・自宅復帰後のふらつきあり"
        />
        <p className="text-xs text-right" style={{ color: "var(--text-muted)" }}>
          {conferenceMemo.length} / 3000字
        </p>
      </section>

      {/* AI生成エントリ（NANDAモード：議事録 → ラベル候補 → 一括生成） */}
      {issueFormat === "nanda" && (
        <section className="card p-5 space-y-3" style={{ borderLeft: "3px solid var(--accent-cyan)" }}>
          <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--accent-cyan)" }}>
            <Sparkles size={16} />
            AIで看護課題を作成（NANDA形式）
          </h2>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            議事録・直近1ヶ月のSOAP・直前の確定計画書から、看護師に立てるべき課題ラベルをAIが提案します（最大5件）。
            選んだラベルに対してOP/TP/EPを一括生成します。
          </p>

          {/* Step 1: ラベル候補提示 */}
          <button onClick={handleSuggestLabels} disabled={suggestingLabels || generatingIssues} className="btn-primary">
            {suggestingLabels ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
            {suggestingLabels ? "候補を提示中..." : "Step 1：課題ラベル候補をAIに提示させる"}
          </button>
          {suggestError && <div className="alert-error text-xs">{suggestError}</div>}

          {/* 候補リスト */}
          {labelCandidates.length > 0 && (
            <div className="p-3 rounded-lg space-y-2" style={{ background: "rgba(0,200,200,0.05)", border: "1px solid rgba(0,200,200,0.15)" }}>
              <div className="text-xs font-semibold" style={{ color: "var(--accent-cyan)" }}>
                AIが提案する課題ラベル（{labelCandidates.length}件）— チェックを入れたものでOP/TP/EPを生成します
              </div>
              <div className="space-y-2">
                {labelCandidates.map((c) => (
                  <label key={c.label} className="flex items-start gap-2 p-2 rounded cursor-pointer hover:bg-black/5">
                    <input
                      type="checkbox"
                      checked={selectedLabels.has(c.label)}
                      onChange={() => toggleLabelSelection(c.label)}
                      className="mt-1"
                    />
                    <div className="flex-1 text-sm">
                      <div className="font-semibold flex items-center gap-2">
                        {c.label}
                        {c.is_continuation && (
                          <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(255,165,0,0.15)", color: "#c46b00" }}>
                            継続
                          </span>
                        )}
                        <span className="text-xs px-1.5 py-0.5 rounded" style={{
                          background: c.priority === "high" ? "rgba(229,62,62,0.12)" : c.priority === "medium" ? "rgba(0,200,200,0.12)" : "rgba(100,100,100,0.12)",
                          color: c.priority === "high" ? "#c53030" : c.priority === "medium" ? "var(--accent-cyan)" : "var(--text-muted)",
                        }}>
                          {c.priority === "high" ? "高" : c.priority === "medium" ? "中" : "低"}
                        </span>
                      </div>
                      <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                        根拠: {c.rationale}
                      </div>
                    </div>
                  </label>
                ))}
              </div>

              {/* カスタム追加 */}
              <div className="flex gap-2 items-center pt-2" style={{ borderTop: "1px dashed rgba(0,0,0,0.1)" }}>
                <input
                  type="text"
                  className="input-field text-sm flex-1"
                  placeholder="自分でラベルを追加（例：服薬管理困難）"
                  value={customLabelInput}
                  onChange={(e) => setCustomLabelInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCustomLabel();
                    }
                  }}
                />
                <button onClick={addCustomLabel} className="btn-outline text-xs" disabled={!customLabelInput.trim()}>
                  <Plus size={14} />
                  追加
                </button>
              </div>

              {/* Step 2: 一括生成 */}
              <button
                onClick={handleGenerateIssuesFromLabels}
                disabled={generatingIssues || selectedLabels.size === 0}
                className="btn-primary w-full mt-2"
              >
                {generatingIssues ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                {generatingIssues
                  ? "OP/TP/EPを生成中..."
                  : `Step 2：選択した${selectedLabels.size}件でOP/TP/EPを一括生成`}
              </button>
              {generateIssuesError && <div className="alert-error text-xs">{generateIssuesError}</div>}
            </div>
          )}

          {aiMeta && (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              最終生成: {aiMeta.generatedAt && new Date(aiMeta.generatedAt).toLocaleString("ja-JP")} / {aiMeta.model} / {aiMeta.promptVersion}
            </p>
          )}
        </section>
      )}

      {/* AI生成ボタン（freeform モード） */}
      {issueFormat === "freeform" && (
        <section className="card p-5 space-y-3" style={{ borderLeft: "3px solid var(--accent-cyan)" }}>
          <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--accent-cyan)" }}>
            <Sparkles size={16} />
            AIで目標・課題を下書き生成（自由記載モード）
          </h2>

          <div className="flex gap-2 items-center text-xs" style={{ color: "var(--text-muted)" }}>
            <span>モード:</span>
            <label className="flex items-center gap-1">
              <input type="radio" name="aiMode" value="from_scratch" checked={aiMode === "from_scratch"} onChange={() => setAiMode("from_scratch")} />
              ゼロから生成
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" name="aiMode" value="refine" checked={aiMode === "refine"} onChange={() => setAiMode("refine")} />
              現在の内容を改善
            </label>
          </div>

          <button onClick={handleGenerateAi} disabled={generating} className="btn-primary">
            {generating ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
            {generating ? "AI生成中..." : aiMode === "refine" ? "現在の内容を改善する" : "AIで下書きを生成する"}
          </button>

          {aiError && <div className="alert-error text-xs">{aiError}</div>}
          {aiMeta && (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              最終生成: {aiMeta.generatedAt && new Date(aiMeta.generatedAt).toLocaleString("ja-JP")} / {aiMeta.model} / {aiMeta.promptVersion}
            </p>
          )}
        </section>
      )}

      {/* 既存計画書のコピペ取り込み */}
      <section className="card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
            <ClipboardList size={16} />
            既存計画書をコピペで取り込み
          </h2>
          <button onClick={() => setShowPasteImport(!showPasteImport)} className="btn-outline text-xs">
            {showPasteImport ? "閉じる" : "開く"}
          </button>
        </div>
        {showPasteImport && (
          <>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              他事業所等で既に立てられている看護計画をそのまま貼り付けます。AIによる整形は行わず、ペースト原文をそのまま1課題として登録します。
              登録後でも評価ボタンから過去SOAPによる評価が可能です。
            </p>
            <textarea
              rows={6}
              maxLength={5000}
              className="input-field text-sm"
              style={{ resize: "vertical", fontFamily: "inherit" }}
              value={pasteImportText}
              onChange={(e) => setPasteImportText(e.target.value)}
              placeholder="例：&#10;不安感増強に伴う日常生活への支障リスク&#10;(観察)&#10;①バイタルサイン&#10;②生活状況&#10;(ケア)&#10;①不安傾聴..."
            />
            <div className="flex justify-end gap-2">
              <span className="text-xs self-center" style={{ color: "var(--text-muted)" }}>
                {pasteImportText.length} / 5000字
              </span>
              <button onClick={handleImportPaste} disabled={!pasteImportText.trim()} className="btn-primary text-sm">
                <Plus size={14} />
                取り込んで課題に追加
              </button>
            </div>
          </>
        )}
      </section>

      {/* 看護・リハビリの目標 */}
      <section className="card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
            <Target size={16} />
            看護・リハビリの目標
            <AiDraftBadge />
          </h2>
          <button
            onClick={() => handleCopy("goal", nursingGoal)}
            className={`btn-copy ${copiedKey === "goal" ? "btn-copy-success" : ""}`}
            disabled={!nursingGoal.trim()}
          >
            <Copy size={14} />
            {copiedKey === "goal" ? "コピー済！" : "コピー"}
          </button>
        </div>
        <textarea
          rows={6}
          maxLength={3000}
          className="input-field text-sm"
          style={{ resize: "vertical", fontFamily: "inherit" }}
          value={nursingGoal}
          onChange={(e) => setNursingGoal(e.target.value)}
          placeholder="AI生成後、看護師が確認・修正してください"
        />
        <p className="text-xs text-right" style={{ color: "var(--text-muted)" }}>
          {nursingGoal.length} / 3000字
        </p>
      </section>

      {/* 療養上の課題・支援内容 */}
      <section className="card p-5 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
            <ClipboardList size={16} />
            療養上の課題・支援内容（{issues.length}件）
            <AiDraftBadge />
          </h2>
          <button
            onClick={issueFormat === "nanda" ? handleAddNandaIssue : handleAddIssue}
            className="btn-outline"
            style={{ padding: "0.25rem 0.75rem", fontSize: "0.75rem" }}
          >
            <Plus size={14} />
            {issueFormat === "nanda" ? "課題を追加（NANDA）" : "行を追加"}
          </button>
        </div>

        {/* 評価AIセクション */}
        {issues.length > 0 && (
          <div className="p-3 rounded-lg space-y-2" style={{ background: "rgba(0,200,200,0.05)", border: "1px solid rgba(0,200,200,0.15)" }}>
            <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: "var(--accent-cyan)" }}>
              <Sparkles size={14} />
              評価をAIで下書き（期間SOAPから総合評価）
            </div>
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span>期間:</span>
              {(Object.keys(EVAL_PERIOD_LABELS) as EvalPeriodKey[]).map((k) => (
                <label key={k} className="flex items-center gap-1">
                  <input type="radio" name="evalPeriod" value={k} checked={evalPeriod === k} onChange={() => setEvalPeriod(k)} />
                  {EVAL_PERIOD_LABELS[k]}
                </label>
              ))}
            </div>
            {evalPeriod === "custom" && (
              <div className="flex items-center gap-2 text-xs">
                <input type="date" className="input-field" style={{ maxWidth: 180 }} value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
                <span>〜</span>
                <input type="date" className="input-field" style={{ maxWidth: 180 }} value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
              </div>
            )}
            <button onClick={handleEvaluate} disabled={evaluating} className="btn-outline">
              {evaluating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {evaluating ? "評価生成中..." : "全課題の評価をAIで生成"}
            </button>
            {evalError && <div className="alert-error text-xs">{evalError}</div>}
          </div>
        )}

        {issues.length === 0 ? (
          <p className="text-sm text-center py-4" style={{ color: "var(--text-muted)" }}>
            課題がまだありません。{issueFormat === "nanda" ? "「AIで看護課題を作成」または「課題を追加」" : "「AIで下書き生成」または「行を追加」"}から始めてください。
          </p>
        ) : (
          <div className="space-y-4">
            {issues.map((iss, idx) => (
              <div key={idx} className="p-4 rounded-lg space-y-2" style={{ background: "var(--bg-tertiary)" }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
                    <span className="font-semibold" style={{ color: "var(--text-primary)" }}>No.{iss.no}</span>
                    <input
                      type="date"
                      className="input-field text-xs"
                      style={{ maxWidth: 150, padding: "0.25rem 0.5rem" }}
                      value={iss.date ?? ""}
                      onChange={(e) =>
                        isNandaIssue(iss)
                          ? handleUpdateNandaIssue(idx, { date: e.target.value })
                          : handleUpdateIssue(idx, { date: e.target.value })
                      }
                    />
                    {isNandaIssue(iss) ? (
                      <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(0,200,200,0.12)", color: "var(--accent-cyan)" }}>NANDA</span>
                    ) : (
                      <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(100,100,100,0.12)", color: "var(--text-muted)" }}>自由記載</span>
                    )}
                    {iss.imported && (
                      <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(255,165,0,0.15)", color: "#c46b00" }}>取り込み</span>
                    )}
                  </div>
                  <button onClick={() => handleRemoveIssue(idx)} className="btn-delete" aria-label="削除">
                    <Trash2 size={14} />
                  </button>
                </div>

                {isNandaIssue(iss) ? (
                  // ===== NANDA形式（統合textarea） =====
                  <NandaIssueRow
                    issue={iss}
                    issueIdx={idx}
                    onUpdateLabel={(label) => handleUpdateNandaIssue(idx, { diagnosisLabel: label })}
                    onUpdateBody={(parsed) => handleUpdateNandaIssue(idx, parsed)}
                    onCopy={(text) => handleCopy(`issue-${idx}`, text)}
                    copiedKey={copiedKey}
                  />
                ) : (
                  // ===== 自由記載 =====
                  <div>
                    <label className="input-label text-xs">課題・支援内容（2500字）</label>
                    <textarea
                      rows={4}
                      maxLength={2500}
                      className="input-field text-sm"
                      style={{ resize: "vertical" }}
                      value={readIssueText(iss)}
                      onChange={(e) => handleUpdateIssue(idx, { issue: e.target.value })}
                    />
                    <div className="flex items-center justify-between text-xs" style={{ color: "var(--text-muted)" }}>
                      <button
                        onClick={() => handleCopy(`issue-${idx}`, readIssueText(iss))}
                        className={`btn-copy ${copiedKey === `issue-${idx}` ? "btn-copy-success" : ""}`}
                        disabled={!readIssueText(iss).trim()}
                      >
                        <Copy size={12} />
                        {copiedKey === `issue-${idx}` ? "コピー済！" : "コピー"}
                      </button>
                      <span>{readIssueText(iss).length} / 2500字</span>
                    </div>
                  </div>
                )}

                {/* 評価（NANDA / freeform 共通） */}
                <div>
                  <label className="input-label text-xs flex items-center gap-2">
                    評価（2500字）
                    <AiDraftBadge />
                  </label>
                  <textarea
                    rows={5}
                    maxLength={2500}
                    className="input-field text-sm"
                    style={{ resize: "vertical" }}
                    value={iss.evaluation ?? ""}
                    onChange={(e) =>
                      isNandaIssue(iss)
                        ? handleUpdateNandaIssue(idx, { evaluation: e.target.value })
                        : handleUpdateIssue(idx, { evaluation: e.target.value })
                    }
                    placeholder="評価は『全課題の評価をAIで生成』ボタンでまとめて下書きできます（期間SOAPから）"
                  />
                  <div className="flex items-center justify-between text-xs" style={{ color: "var(--text-muted)" }}>
                    <button
                      onClick={() => handleCopy(`eval-${idx}`, iss.evaluation ?? "")}
                      className={`btn-copy ${copiedKey === `eval-${idx}` ? "btn-copy-success" : ""}`}
                      disabled={!iss.evaluation?.trim()}
                    >
                      <Copy size={12} />
                      {copiedKey === `eval-${idx}` ? "コピー済！" : "コピー"}
                    </button>
                    <span>
                      {iss.evaluatedAt && (
                        <span className="mr-2">AI生成: {new Date(iss.evaluatedAt).toLocaleString("ja-JP")}</span>
                      )}
                      {(iss.evaluation ?? "").length} / 2500字
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 衛生材料 */}
      <section className="card p-5 space-y-3" style={{ borderLeft: "3px solid var(--accent-error, #e53e3e)" }}>
        <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
          <Package size={16} />
          衛生材料の情報
          <SafetyCriticalBadge />
        </h2>
        <p className="text-xs" style={{ color: "var(--accent-error, #e53e3e)" }}>
          ※ 医療材料の種類・サイズ・数量は誤選定時の医療安全リスクが高いため、AI下書きを行わず看護師の手入力のみで運用しています。
        </p>

        <div className="flex gap-3 text-sm">
          <label className="flex items-center gap-1">
            <input type="radio" name="hasSupplies" checked={!hasSupplies} onChange={() => setHasSupplies(false)} />
            なし
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" name="hasSupplies" checked={hasSupplies} onChange={() => setHasSupplies(true)} />
            あり
          </label>
        </div>

        {hasSupplies && (
          <div className="space-y-3">
            <div>
              <label className="input-label text-xs">処置の内容（3000字）</label>
              <textarea rows={3} maxLength={3000} className="input-field text-sm" value={supplyProcedure} onChange={(e) => setSupplyProcedure(e.target.value)} />
            </div>
            <div>
              <label className="input-label text-xs">衛生材料（種類・サイズ）等（3000字）</label>
              <textarea rows={3} maxLength={3000} className="input-field text-sm" value={supplyMaterials} onChange={(e) => setSupplyMaterials(e.target.value)} />
            </div>
            <div>
              <label className="input-label text-xs">必要量（3000字）</label>
              <textarea rows={3} maxLength={3000} className="input-field text-sm" value={supplyQuantity} onChange={(e) => setSupplyQuantity(e.target.value)} />
            </div>
          </div>
        )}
      </section>

      {/* 備考 */}
      <section className="card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
            <MessageSquare size={16} />
            備考
            <AiDraftBadge />
          </h2>
          <button
            onClick={() => handleCopy("remarks", remarks)}
            className={`btn-copy ${copiedKey === "remarks" ? "btn-copy-success" : ""}`}
            disabled={!remarks.trim()}
          >
            <Copy size={14} />
            {copiedKey === "remarks" ? "コピー済！" : "コピー"}
          </button>
        </div>
        <textarea rows={4} maxLength={3000} className="input-field text-sm" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        <p className="text-xs text-right" style={{ color: "var(--text-muted)" }}>
          {remarks.length} / 3000字
        </p>
      </section>

      {/* 保存ボタン */}
      <section className="card p-5 space-y-3" style={{ position: "sticky", bottom: 0, zIndex: 10 }}>
        <div className="flex gap-3 flex-wrap">
          <button onClick={() => handleSave(true)} disabled={saving} className="btn-outline flex-1">
            {saving ? <Loader2 size={18} className="animate-spin" /> : <FileEdit size={18} />}
            {saving ? "保存中..." : "下書きとして保存"}
          </button>
          <button onClick={() => handleSave(false)} disabled={saving} className="btn-save flex-1">
            {saving ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
            {saving ? "保存中..." : "確定保存"}
          </button>
        </div>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          確定保存するとSOAP生成の参照対象になります（下書きは参照されません）
        </p>
      </section>
    </main>
  );
}

// ============================================================
// バッジコンポーネント
// ============================================================
function AiDraftBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded"
      style={{ background: "rgba(0,200,200,0.1)", color: "var(--accent-cyan)" }}
      title="AI下書き可（看護師確認必須）"
    >
      <Bot size={11} />
      AI下書き可
    </span>
  );
}

function UserInputBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded"
      style={{ background: "rgba(100,100,100,0.1)", color: "var(--text-muted)" }}
      title="看護師記入項目"
    >
      <UserIcon size={11} />
      看護師記入
    </span>
  );
}

/**
 * NANDA形式の課題1行分の表示UI。
 *
 * UI: 「課題ラベル」(input) + 「課題内容」(大きいtextarea)
 * - 内容textareaは OP/TP/EP を整形した状態で表示（カイポケ貼り付け用）
 * - 編集中はローカル bodyText を保持し、変更があるたびに parseBodyText で OP/TP/EP に分割して親へ通知
 * - issue.aiGeneratedAt が変わったら（AI再生成）外部からの変更として bodyText を再同期
 */
function NandaIssueRow({
  issue,
  issueIdx,
  onUpdateLabel,
  onUpdateBody,
  onCopy,
  copiedKey,
}: {
  issue: NursingCareIssueNanda;
  issueIdx: number;
  onUpdateLabel: (label: string) => void;
  onUpdateBody: (parsed: { op: string[]; tp: string[]; ep: string[] }) => void;
  onCopy: (text: string) => void;
  copiedKey: string | null;
}) {
  const [bodyText, setBodyText] = useState<string>(() => issueToBodyText(issue));

  // AI再生成・取り込み等の外部変更時に bodyText を再同期
  // aiGeneratedAt が変わったか、issueIdx が変わった（行入替）タイミングで反映
  useEffect(() => {
    setBodyText(issueToBodyText(issue));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue.aiGeneratedAt, issue.importedAt, issueIdx]);

  function handleBodyChange(text: string) {
    setBodyText(text);
    onUpdateBody(parseBodyText(text));
  }

  const totalChars = issue.diagnosisLabel.length + bodyText.length;

  return (
    <>
      <div>
        <label className="input-label text-xs">課題ラベル</label>
        <input
          type="text"
          className="input-field text-sm"
          value={issue.diagnosisLabel}
          onChange={(e) => onUpdateLabel(e.target.value)}
          placeholder="例：不安感増強に伴う日常生活への支障リスク"
        />
      </div>

      <div>
        <label className="input-label text-xs">
          課題内容（OP / TP / EP まとめて編集可）
        </label>
        <textarea
          rows={12}
          maxLength={2500}
          className="input-field text-sm"
          style={{ resize: "vertical", fontFamily: "inherit" }}
          value={bodyText}
          onChange={(e) => handleBodyChange(e.target.value)}
          placeholder={"(観察)\n①バイタルサイン（体温・血圧・脈拍・呼吸・SpO2）を毎訪問時測定\n②生活状況（清潔・食事・排泄・更衣・移動・睡眠）\n\n(ケア)\n①不安傾聴と共感的対応を毎訪問時5〜10分実施\n\n(指導)\n①休息の取り方と疲労時の対処法を本人・家族に説明"}
        />
        <div className="flex items-center justify-between text-xs" style={{ color: "var(--text-muted)" }}>
          <button
            onClick={() => onCopy(`${issue.diagnosisLabel}\n${bodyText}`.trim())}
            className={`btn-copy ${copiedKey === `issue-${issueIdx}` ? "btn-copy-success" : ""}`}
            disabled={!issue.diagnosisLabel.trim() && !bodyText.trim()}
          >
            <Copy size={12} />
            {copiedKey === `issue-${issueIdx}` ? "コピー済！" : "課題まとめてコピー（カイポケ用）"}
          </button>
          <span>{totalChars} / 2500字</span>
        </div>
      </div>
    </>
  );
}

function SafetyCriticalBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded"
      style={{ background: "rgba(229, 62, 62, 0.12)", color: "var(--accent-error, #c53030)", fontWeight: 600 }}
      title="医療安全上AIによる下書きを禁止している項目です"
    >
      <UserIcon size={11} />
      看護師記入（AI下書き禁止領域）
    </span>
  );
}
