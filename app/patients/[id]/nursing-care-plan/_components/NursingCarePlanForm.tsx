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

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  saveNursingCarePlan,
  type NursingCarePlan,
  type NursingCarePlanType,
  type NursingCarePlanTitle,
  type NursingCarePlanIssue,
  type Patient,
  type SoapRecord,
} from "@/lib/storage";
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

  // ---- 療養上の課題・支援内容 ----
  const [issues, setIssues] = useState<NursingCarePlanIssue[]>(
    initialPlan?.issues ?? []
  );

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

  function handleAddIssue() {
    const nextNo = issues.length > 0 ? Math.max(...issues.map((i) => i.no)) + 1 : 1;
    setIssues([...issues, { no: nextNo, date: planDate, issue: "", evaluation: "" }]);
  }

  function handleUpdateIssue(idx: number, patch: Partial<NursingCarePlanIssue>) {
    setIssues(issues.map((iss, i) => (i === idx ? { ...iss, ...patch } : iss)));
  }

  function handleRemoveIssue(idx: number) {
    if (!confirm("この課題を削除しますか？")) return;
    setIssues(issues.filter((_, i) => i !== idx));
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
          recentSoapRecords: recentRecords.slice(0, 5).map((r) => ({
            visitDate: r.visitDate,
            S: r.S,
            O: r.O,
            A: r.A,
            P: r.P,
          })),
          mode: aiMode,
          existingGoal: aiMode === "refine" ? nursingGoal : undefined,
          existingIssues: aiMode === "refine" ? issues.map((i) => ({ no: i.no, issue: i.issue })) : undefined,
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
            issue: i.issue,
            evaluation: existing?.evaluation ?? "",
            evaluatedAt: existing?.evaluatedAt,
          };
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
    const nonEmptyIssues = issues.filter((i) => i.issue.trim());
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
          issues: nonEmptyIssues.map((i) => ({ no: i.no, issue: i.issue })),
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

        <div className="grid grid-cols-2 gap-3">
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
        <div className="grid grid-cols-2 gap-3">
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

      {/* AI生成ボタン（目標・課題） */}
      <section className="card p-5 space-y-3" style={{ borderLeft: "3px solid var(--accent-cyan)" }}>
        <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--accent-cyan)" }}>
          <Sparkles size={16} />
          AIで目標・課題を下書き生成
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
          <button onClick={handleAddIssue} className="btn-outline" style={{ padding: "0.25rem 0.75rem", fontSize: "0.75rem" }}>
            <Plus size={14} />
            行を追加
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
            課題がまだありません。「AIで下書き生成」または「行を追加」から始めてください。
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
                      onChange={(e) => handleUpdateIssue(idx, { date: e.target.value })}
                    />
                  </div>
                  <button onClick={() => handleRemoveIssue(idx)} className="btn-delete" aria-label="削除">
                    <Trash2 size={14} />
                  </button>
                </div>

                <div>
                  <label className="input-label text-xs">課題・支援内容（2500字）</label>
                  <textarea
                    rows={4}
                    maxLength={2500}
                    className="input-field text-sm"
                    style={{ resize: "vertical" }}
                    value={iss.issue}
                    onChange={(e) => handleUpdateIssue(idx, { issue: e.target.value })}
                  />
                  <div className="flex items-center justify-between text-xs" style={{ color: "var(--text-muted)" }}>
                    <button
                      onClick={() => handleCopy(`issue-${idx}`, iss.issue)}
                      className={`btn-copy ${copiedKey === `issue-${idx}` ? "btn-copy-success" : ""}`}
                      disabled={!iss.issue.trim()}
                    >
                      <Copy size={12} />
                      {copiedKey === `issue-${idx}` ? "コピー済！" : "コピー"}
                    </button>
                    <span>{iss.issue.length} / 2500字</span>
                  </div>
                </div>

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
                    onChange={(e) => handleUpdateIssue(idx, { evaluation: e.target.value })}
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
