"use client";

/**
 * 褥瘡計画書 共通フォームコンポーネント
 *
 * new / edit / copy の3モードを props で切り替え。
 *   - mode="new"  : 新規作成（initialPlan なし）
 *   - mode="new"  + initialPlan あり : 複製モード（判定項目のみコピー、AIドラフトは空）
 *   - mode="edit" : 既存計画書の編集（initialPlan と planId を渡す）
 *
 * 将来的な報告書3様式・計画評価でも同様の構造を踏襲できるよう、
 * 入力セクション→AI生成→編集→保存の一般化されたパターンを提供する。
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  savePressureUlcerPlan,
  type Patient,
  type DailyLifeLevel,
  type RiskFactors,
  type UlcerLocation,
  type DesignR,
  type SoapRecord,
  type PressureUlcerPlan,
} from "@/lib/storage";
import { AlertTriangle, Stethoscope, Sparkles, Save, Copy, Loader2, HelpCircle, Calculator, FileEdit } from "lucide-react";
import {
  DailyLifeLevelHelp,
  OhScaleHelp,
  RiskFactorGeneralHelp,
  RISK_FACTOR_HINTS,
  DesignRHelp,
} from "./HelpContent";

// ============================================================
// AI応答型
// ============================================================
interface AiPlanResponse {
  plan_bed: string | null;
  plan_chair: string | null;
  plan_skincare: string | null;
  plan_nutrition: string | null;
  plan_rehab: string | null;
  next_review_date: string;
  ai_notice: string;
  not_applicable?: boolean;
  reason?: string;
  _ai_meta?: {
    model: string;
    prompt_version: string;
    generated_at: string;
  };
}

// ============================================================
// 選択肢定数
// ============================================================
const DAILY_LIFE_LEVELS: { value: DailyLifeLevel; label: string; applicable: boolean }[] = [
  { value: "J1", label: "J1（自立）", applicable: false },
  { value: "J2", label: "J2（自立）", applicable: false },
  { value: "A1", label: "A1（準寝たきり）", applicable: false },
  { value: "A2", label: "A2（準寝たきり）", applicable: false },
  { value: "B1", label: "B1（寝たきり）", applicable: true },
  { value: "B2", label: "B2（寝たきり）", applicable: true },
  { value: "C1", label: "C1（寝たきり）", applicable: true },
  { value: "C2", label: "C2（寝たきり）", applicable: true },
];

const RISK_FACTORS: {
  key: keyof RiskFactors;
  label: string;
  options: readonly ["できる", "できない"] | readonly ["なし", "あり"];
}[] = [
  { key: "basicMobilityBed", label: "基本的動作能力（ベッド上の自力体位変換）", options: ["できる", "できない"] as const },
  { key: "basicMobilityChair", label: "基本的動作能力(イス上の座位保持・除圧)", options: ["できる", "できない"] as const },
  { key: "bonyProminence", label: "病的骨突出", options: ["なし", "あり"] as const },
  { key: "contracture", label: "関節拘縮", options: ["なし", "あり"] as const },
  { key: "nutrition", label: "栄養状態低下", options: ["なし", "あり"] as const },
  { key: "moisture", label: "皮膚湿潤（多汗・尿失禁・便失禁）", options: ["なし", "あり"] as const },
  { key: "fragileSkin", label: "皮膚の脆弱性（浮腫・スキン-テア保有/既往）", options: ["なし", "あり"] as const },
];

const ULCER_LOCATIONS: UlcerLocation[] = ["仙骨部", "坐骨部", "尾骨部", "腸骨部", "大転子部", "踵部", "その他"];

const DESIGN_R_OPTIONS = {
  d: { label: "D（深さ）", items: ["d0", "d1", "d2", "D3", "D4", "D5", "DDTI", "DU"] },
  e: { label: "E（滲出液）", items: ["e0", "e1", "e3", "E6"] },
  s: { label: "S（大きさcm²）", items: ["s0", "s3", "s6", "s8", "s9", "s12", "S15"] },
  i: { label: "I（炎症・感染）", items: ["i0", "i1", "I3", "I3C", "I9"] },
  g: { label: "G（肉芽）", items: ["g0", "g1", "g3", "G4", "G5", "G6"] },
  n: { label: "N（壊死組織）", items: ["n0", "N3", "N6"] },
  p: { label: "P（ポケット）", items: ["p0", "P6", "P9", "P12", "P24"] },
} as const;

// ============================================================
// プロップス
// ============================================================
export interface PressureUlcerPlanFormProps {
  patient: Patient;
  recentRecords: SoapRecord[];
  mode: "new" | "edit";
  initialPlan?: PressureUlcerPlan;
  /** 複製モードかどうか（mode="new"+initialPlanの組み合わせで複製時にtrue） */
  isCopy?: boolean;
}

/**
 * 「その他（詳細）」形式の文字列から詳細部分を抽出
 * 例: "その他（右肩甲骨）" → { isOther: true, detail: "右肩甲骨" }
 */
function parseOtherLocation(loc: UlcerLocation | string): { baseLocation: UlcerLocation | null; detail: string } {
  if (typeof loc === "string" && loc.startsWith("その他")) {
    const match = loc.match(/^その他（(.*)）$/);
    if (match) return { baseLocation: "その他", detail: match[1] };
    return { baseLocation: "その他", detail: "" };
  }
  if (ULCER_LOCATIONS.includes(loc as UlcerLocation)) {
    return { baseLocation: loc as UlcerLocation, detail: "" };
  }
  return { baseLocation: null, detail: "" };
}

/**
 * 保存済み部位配列からUI用の基本部位配列と詳細文字列を復元
 */
function extractLocationsAndDetail(saved: (UlcerLocation | string)[] | undefined): {
  locations: UlcerLocation[];
  otherDetail: string;
} {
  if (!saved || saved.length === 0) return { locations: [], otherDetail: "" };
  const locations: UlcerLocation[] = [];
  let otherDetail = "";
  for (const s of saved) {
    const parsed = parseOtherLocation(s);
    if (parsed.baseLocation) {
      if (!locations.includes(parsed.baseLocation)) locations.push(parsed.baseLocation);
      if (parsed.baseLocation === "その他" && parsed.detail) otherDetail = parsed.detail;
    }
  }
  return { locations, otherDetail };
}

// ============================================================
// フォーム本体
// ============================================================
export default function PressureUlcerPlanForm({
  patient,
  recentRecords,
  mode,
  initialPlan,
  isCopy = false,
}: PressureUlcerPlanFormProps) {
  const router = useRouter();

  // 複製モードの場合、一部フィールドはコピーせず空にする
  const copyInitial = isCopy && initialPlan;

  // 初期値生成ヘルパー
  const initialCurrentLocs = initialPlan
    ? extractLocationsAndDetail(initialPlan.currentLocations)
    : { locations: [], otherDetail: "" };
  const initialPastLocs = initialPlan
    ? extractLocationsAndDetail(initialPlan.pastLocations)
    : { locations: [], otherDetail: "" };

  // ---- 基本情報 ----
  const [planDate, setPlanDate] = useState(
    copyInitial
      ? new Date().toISOString().slice(0, 10)  // 複製時は今日
      : initialPlan?.planDate ?? new Date().toISOString().slice(0, 10)
  );
  const [staffName, setStaffName] = useState(copyInitial ? "" : initialPlan?.staffName ?? "");
  const [staffTitle, setStaffTitle] = useState(copyInitial ? "看護師" : initialPlan?.staffTitle ?? "看護師");

  // ---- 看護師判定項目 ----
  const [dailyLifeLevel, setDailyLifeLevel] = useState<DailyLifeLevel | "">(initialPlan?.dailyLifeLevel ?? "");
  const [ohScaleScore, setOhScaleScore] = useState<string>(
    initialPlan?.ohScaleScore !== undefined ? String(initialPlan.ohScaleScore) : ""
  );
  const [riskFactors, setRiskFactors] = useState<RiskFactors>(initialPlan?.riskFactors ?? {});

  // ---- 褥瘡の有無 ----
  const [hasCurrentUlcer, setHasCurrentUlcer] = useState(initialPlan?.hasCurrentUlcer ?? false);
  const [currentLocations, setCurrentLocations] = useState<UlcerLocation[]>(initialCurrentLocs.locations);
  const [currentOtherDetail, setCurrentOtherDetail] = useState(initialCurrentLocs.otherDetail);
  const [currentOnsetDate, setCurrentOnsetDate] = useState(copyInitial ? "" : initialPlan?.currentOnsetDate ?? "");
  const [hasPastUlcer, setHasPastUlcer] = useState(initialPlan?.hasPastUlcer ?? false);
  const [pastLocations, setPastLocations] = useState<UlcerLocation[]>(initialPastLocs.locations);
  const [pastOtherDetail, setPastOtherDetail] = useState(initialPastLocs.otherDetail);
  const [pastHealedDate, setPastHealedDate] = useState(copyInitial ? "" : initialPlan?.pastHealedDate ?? "");

  // ---- DESIGN-R ----
  const [designR, setDesignR] = useState<DesignR>(initialPlan?.designR ?? {});

  // ---- AI生成結果（複製時は空にして再生成を促す） ----
  const [generating, setGenerating] = useState(false);
  const [aiError, setAiError] = useState("");
  const [planBed, setPlanBed] = useState(copyInitial ? "" : initialPlan?.planBed ?? "");
  const [planChair, setPlanChair] = useState(copyInitial ? "" : initialPlan?.planChair ?? "");
  const [planSkincare, setPlanSkincare] = useState(copyInitial ? "" : initialPlan?.planSkincare ?? "");
  const [planNutrition, setPlanNutrition] = useState(copyInitial ? "" : initialPlan?.planNutrition ?? "");
  const [planRehab, setPlanRehab] = useState(copyInitial ? "" : initialPlan?.planRehab ?? "");
  const [nextReviewDate, setNextReviewDate] = useState(copyInitial ? "" : initialPlan?.nextReviewDate ?? "");
  const [aiGeneratedAt, setAiGeneratedAt] = useState<string | undefined>(copyInitial ? undefined : initialPlan?.aiGeneratedAt);
  const [aiModel, setAiModel] = useState<string | undefined>(copyInitial ? undefined : initialPlan?.aiModel);
  const [aiPromptVersion, setAiPromptVersion] = useState<string | undefined>(copyInitial ? undefined : initialPlan?.aiPromptVersion);

  // ---- 保存 ----
  const [saving, setSaving] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // ---- ヘルプ / 計算機 ----
  const [helpOpen, setHelpOpen] = useState<Record<string, boolean>>({});
  const [riskFactorHintOpen, setRiskFactorHintOpen] = useState<Record<string, boolean>>({});
  const [ohCalcOpen, setOhCalcOpen] = useState(false);
  const [ohCalc, setOhCalc] = useState<{
    mobility: number | null;
    bonyProminence: number | null;
    edema: number | null;
    contracture: number | null;
  }>({ mobility: null, bonyProminence: null, edema: null, contracture: null });

  function toggleHelp(key: string) {
    setHelpOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  }
  function toggleRiskHint(key: string) {
    setRiskFactorHintOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  }
  function updateOhCalc(field: keyof typeof ohCalc, value: number) {
    const next = { ...ohCalc, [field]: value };
    setOhCalc(next);
    const allSet = Object.values(next).every((v) => v !== null);
    if (allSet) {
      const total = (next.mobility ?? 0) + (next.bonyProminence ?? 0) + (next.edema ?? 0) + (next.contracture ?? 0);
      setOhScaleScore(String(Math.round(total)));
    }
  }

  // 自立度がA2以下か
  const selectedLevelInfo = DAILY_LIFE_LEVELS.find((l) => l.value === dailyLifeLevel);
  const isNotApplicable = selectedLevelInfo && !selectedLevelInfo.applicable;

  // 危険因子の「あり/できない」数
  const hasAnyRiskFactor = Object.entries(riskFactors).some(([, v]) => v === "あり" || v === "できない");

  // 「その他」の詳細未入力判定
  const needsCurrentOtherDetail = hasCurrentUlcer && currentLocations.includes("その他") && !currentOtherDetail.trim();
  const needsPastOtherDetail = hasPastUlcer && pastLocations.includes("その他") && !pastOtherDetail.trim();

  const canProceed =
    !!dailyLifeLevel &&
    !isNotApplicable &&
    ohScaleScore !== "" &&
    Number(ohScaleScore) >= 0 &&
    Number(ohScaleScore) <= 10 &&
    !needsCurrentOtherDetail &&
    !needsPastOtherDetail;

  const hasAnyDraft =
    planBed.trim() || planChair.trim() || planSkincare.trim() || planNutrition.trim() || planRehab.trim();

  function toggleCurrentLocation(loc: UlcerLocation) {
    setCurrentLocations((prev) => (prev.includes(loc) ? prev.filter((l) => l !== loc) : [...prev, loc]));
  }
  function togglePastLocation(loc: UlcerLocation) {
    setPastLocations((prev) => (prev.includes(loc) ? prev.filter((l) => l !== loc) : [...prev, loc]));
  }

  function buildEffectiveLocations(locations: UlcerLocation[], otherDetail: string): (UlcerLocation | string)[] {
    return locations.map((l) => (l === "その他" && otherDetail.trim() ? `その他（${otherDetail.trim()}）` : l));
  }

  // ============================================================
  // AI生成
  // ============================================================
  async function handleGenerate() {
    if (!dailyLifeLevel || ohScaleScore === "") {
      alert("日常生活自立度とOHスケール点数を先に入力してください");
      return;
    }
    setGenerating(true);
    setAiError("");
    try {
      const res = await fetch("/api/pressure-ulcer-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient: { age: patient.age, diagnosis: patient.diagnosis, care_level: patient.careLevel },
          plan_date: planDate,
          daily_life_level: dailyLifeLevel,
          oh_scale_score: Number(ohScaleScore),
          risk_factors: {
            basic_mobility_bed: riskFactors.basicMobilityBed,
            basic_mobility_chair: riskFactors.basicMobilityChair,
            bony_prominence: riskFactors.bonyProminence,
            contracture: riskFactors.contracture,
            nutrition: riskFactors.nutrition,
            moisture: riskFactors.moisture,
            fragile_skin: riskFactors.fragileSkin,
          },
          has_current_ulcer: hasCurrentUlcer,
          current_locations: buildEffectiveLocations(currentLocations, currentOtherDetail),
          design_r: designR,
          recent_soap_records: recentRecords.map((r) => ({
            visit_date: r.visitDate, S: r.S, O: r.O, A: r.A, P: r.P,
          })),
        }),
      });
      const data: AiPlanResponse & { error?: string } = await res.json();
      if (!res.ok) throw new Error(data.error || "AI生成に失敗しました");
      if (data.not_applicable) {
        setAiError(data.reason || "計画作成不要");
        return;
      }
      setPlanBed(data.plan_bed ?? "");
      setPlanChair(data.plan_chair ?? "");
      setPlanSkincare(data.plan_skincare ?? "");
      setPlanNutrition(data.plan_nutrition ?? "");
      setPlanRehab(data.plan_rehab ?? "");
      setNextReviewDate(data.next_review_date);
      setAiGeneratedAt(data._ai_meta?.generated_at);
      setAiModel(data._ai_meta?.model);
      setAiPromptVersion(data._ai_meta?.prompt_version);
      setTimeout(() => {
        document.getElementById("ai-draft")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "AI生成中にエラーが発生しました");
    } finally {
      setGenerating(false);
    }
  }

  // ============================================================
  // 保存（下書き / 確定版 共通）
  // ============================================================
  async function doSave(isDraft: boolean) {
    if (!dailyLifeLevel || ohScaleScore === "") {
      alert("日常生活自立度とOHスケール点数を先に入力してください");
      return;
    }
    if (isDraft) setSavingDraft(true); else setSaving(true);
    setSaveError("");
    try {
      const saved = await savePressureUlcerPlan({
        id: mode === "edit" ? initialPlan?.id : undefined,
        patientId: patient.id,
        planDate,
        nextReviewDate: nextReviewDate || undefined,
        staffName: staffName || undefined,
        staffTitle: staffTitle || undefined,
        dailyLifeLevel: dailyLifeLevel || undefined,
        riskFactors,
        ohScaleScore: Number(ohScaleScore),
        hasCurrentUlcer,
        currentLocations: buildEffectiveLocations(currentLocations, currentOtherDetail),
        currentOnsetDate: currentOnsetDate || undefined,
        hasPastUlcer,
        pastLocations: buildEffectiveLocations(pastLocations, pastOtherDetail),
        pastHealedDate: pastHealedDate || undefined,
        designR,
        planBed: planBed || undefined,
        planChair: planChair || undefined,
        planSkincare: planSkincare || undefined,
        planNutrition: planNutrition || undefined,
        planRehab: planRehab || undefined,
        isDraft,
        aiModel,
        aiPromptVersion,
        aiGeneratedAt,
      });
      if (!saved) throw new Error("保存に失敗しました");
      router.push(`/patients/${patient.id}/pressure-ulcer-plan`);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "保存中にエラーが発生しました");
    } finally {
      setSaving(false);
      setSavingDraft(false);
    }
  }

  function handleSaveDraft() { doSave(true); }
  function handleSave() { doSave(false); }

  function handleCopy(key: string, text: string) {
    if (!text.trim()) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  // ============================================================
  // レンダリング
  // ============================================================
  return (
    <main className="max-w-2xl mx-auto px-4 py-6 relative z-[1] space-y-6">
      {/* 複製モードの通知 */}
      {isCopy && (
        <section className="card p-4" style={{ background: "rgba(139, 92, 246, 0.08)", borderLeft: "4px solid #8B5CF6" }}>
          <div className="flex gap-2 items-start">
            <Copy size={18} style={{ color: "#7C3AED", flexShrink: 0, marginTop: 2 }} />
            <div className="text-sm">
              <p className="font-semibold mb-1" style={{ color: "#6D28D9" }}>過去の計画書から複製中</p>
              <p style={{ color: "var(--text-secondary)" }}>
                看護師判定項目を引き継いでいます。必要に応じて修正後、AIドラフトを再生成してください。
                <br />記入看護師名・肩書き、発生日、AIドラフトは引き継いでいません。
              </p>
            </div>
          </div>
        </section>
      )}

      {/* 編集モードの通知 */}
      {mode === "edit" && (
        <section className="card p-4" style={{ background: "rgba(245, 158, 11, 0.08)", borderLeft: "4px solid #F59E0B" }}>
          <div className="flex gap-2 items-start">
            <FileEdit size={18} style={{ color: "#D97706", flexShrink: 0, marginTop: 2 }} />
            <div className="text-sm">
              <p className="font-semibold mb-1" style={{ color: "#B45309" }}>既存計画書を編集中</p>
              <p style={{ color: "var(--text-secondary)" }}>
                {initialPlan?.isDraft ? "下書きを編集しています。" : "確定済みの計画書を編集しています。"}
                保存すると上書きされます。
              </p>
            </div>
          </div>
        </section>
      )}

      {/* 注意事項 */}
      <section className="card p-4" style={{ background: "rgba(255, 193, 7, 0.08)", borderLeft: "4px solid #FFC107" }}>
        <div className="flex gap-2 items-start">
          <AlertTriangle size={18} style={{ color: "#F57C00", flexShrink: 0, marginTop: 2 }} />
          <div className="text-sm">
            <p className="font-semibold mb-1" style={{ color: "#E65100" }}>看護師判定が必要な項目</p>
            <p style={{ color: "var(--text-secondary)" }}>
              日常生活自立度・OHスケール・危険因子・DESIGN-R採点は <strong>看護師が判断</strong>してください。
              AIはこれらを判定しません。
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>計画作成日</label>
            <input type="date" value={planDate} onChange={(e) => setPlanDate(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" style={{ borderColor: "rgba(0,0,0,0.1)" }} />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>記入看護師名</label>
            <input type="text" value={staffName} onChange={(e) => setStaffName(e.target.value)} placeholder="例: 平田 花子" className="w-full px-3 py-2 border rounded-lg text-sm" style={{ borderColor: "rgba(0,0,0,0.1)" }} />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>肩書き</label>
            <input type="text" value={staffTitle} onChange={(e) => setStaffTitle(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" style={{ borderColor: "rgba(0,0,0,0.1)" }} />
          </div>
        </div>
      </section>

      {/* 日常生活自立度 */}
      <section className="card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>日常生活自立度 <span className="text-red-500">*</span></h2>
          <button type="button" onClick={() => toggleHelp("dailyLife")} className="text-xs flex items-center gap-1 px-2 py-1 rounded border hover:bg-gray-50" style={{ borderColor: "rgba(0,0,0,0.1)", color: "var(--text-muted)" }}>
            <HelpCircle size={12} />
            {helpOpen["dailyLife"] ? "基準を閉じる" : "判定基準を見る"}
          </button>
        </div>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>A2以下は計画立案不要。B1以上で作成必須。</p>
        {helpOpen["dailyLife"] && <DailyLifeLevelHelp />}
        <div className="grid grid-cols-4 gap-2">
          {DAILY_LIFE_LEVELS.map((level) => (
            <button key={level.value} type="button" onClick={() => setDailyLifeLevel(level.value)}
              className={`px-3 py-2 text-xs rounded-lg border transition ${
                dailyLifeLevel === level.value
                  ? level.applicable ? "bg-blue-500 text-white border-blue-500" : "bg-gray-400 text-white border-gray-400"
                  : "bg-white hover:bg-gray-50"
              }`}
              style={{ borderColor: dailyLifeLevel === level.value ? undefined : "rgba(0,0,0,0.1)" }}>
              {level.value}
            </button>
          ))}
        </div>
        {isNotApplicable && (
          <div className="p-3 rounded-lg text-sm" style={{ background: "rgba(255, 193, 7, 0.1)", color: "#E65100" }}>
            ⚠ 自立度{dailyLifeLevel}は計画作成不要です。B1以上を選択してください。
          </div>
        )}
      </section>

      {dailyLifeLevel && !isNotApplicable && (
        <>
          {/* OHスケール */}
          <section className="card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>OHスケール点数 <span className="text-red-500">*</span></h2>
              <button type="button" onClick={() => toggleHelp("ohScale")} className="text-xs flex items-center gap-1 px-2 py-1 rounded border hover:bg-gray-50" style={{ borderColor: "rgba(0,0,0,0.1)", color: "var(--text-muted)" }}>
                <HelpCircle size={12} />
                {helpOpen["ohScale"] ? "基準を閉じる" : "判定基準を見る"}
              </button>
            </div>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>0-10点。分類: 0=なし / 1-3=軽度 / 4-6=中等度 / 7-10=高度</p>
            {helpOpen["ohScale"] && <OhScaleHelp />}
            <div className="flex items-center gap-3">
              <input type="number" min={0} max={10} value={ohScaleScore} onChange={(e) => setOhScaleScore(e.target.value)} placeholder="0〜10" className="w-32 px-3 py-2 border rounded-lg text-sm" style={{ borderColor: "rgba(0,0,0,0.1)" }} />
              <button type="button" onClick={() => setOhCalcOpen(!ohCalcOpen)} className="text-xs flex items-center gap-1 px-3 py-2 rounded-lg border hover:bg-gray-50" style={{ borderColor: "rgba(0,0,0,0.1)", color: "var(--text-secondary)" }}>
                <Calculator size={14} />
                {ohCalcOpen ? "計算機を閉じる" : "自動計算で入力"}
              </button>
            </div>
            {ohCalcOpen && (
              <div className="mt-3 p-4 rounded-lg space-y-3 animate-fade-in" style={{ background: "rgba(99, 102, 241, 0.05)", border: "1px solid rgba(99, 102, 241, 0.15)" }}>
                <p className="text-xs font-semibold" style={{ color: "#4338CA" }}>4項目を選択すると自動で合計点が入力されます</p>
                <div>
                  <p className="text-xs font-semibold mb-2">① 自力体位変換能力</p>
                  <div className="flex flex-wrap gap-2">
                    {[{ label: "できる", val: 0 }, { label: "どちらでもない", val: 1.5 }, { label: "できない", val: 3 }].map((o) => (
                      <button key={o.val} type="button" onClick={() => updateOhCalc("mobility", o.val)} className={`px-3 py-1.5 text-xs rounded-lg border ${ohCalc.mobility === o.val ? "bg-indigo-500 text-white border-indigo-500" : "bg-white hover:bg-gray-50"}`} style={{ borderColor: ohCalc.mobility === o.val ? undefined : "rgba(0,0,0,0.1)" }}>{o.label}（{o.val}）</button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold mb-2">② 病的骨突出（仙骨部）</p>
                  <div className="flex flex-wrap gap-2">
                    {[{ label: "なし", val: 0 }, { label: "軽度・中等度", val: 1.5 }, { label: "高度", val: 3 }].map((o) => (
                      <button key={o.val} type="button" onClick={() => updateOhCalc("bonyProminence", o.val)} className={`px-3 py-1.5 text-xs rounded-lg border ${ohCalc.bonyProminence === o.val ? "bg-indigo-500 text-white border-indigo-500" : "bg-white hover:bg-gray-50"}`} style={{ borderColor: ohCalc.bonyProminence === o.val ? undefined : "rgba(0,0,0,0.1)" }}>{o.label}（{o.val}）</button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold mb-2">③ 浮腫</p>
                  <div className="flex flex-wrap gap-2">
                    {[{ label: "なし", val: 0 }, { label: "あり", val: 3 }].map((o) => (
                      <button key={o.val} type="button" onClick={() => updateOhCalc("edema", o.val)} className={`px-3 py-1.5 text-xs rounded-lg border ${ohCalc.edema === o.val ? "bg-indigo-500 text-white border-indigo-500" : "bg-white hover:bg-gray-50"}`} style={{ borderColor: ohCalc.edema === o.val ? undefined : "rgba(0,0,0,0.1)" }}>{o.label}（{o.val}）</button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold mb-2">④ 関節拘縮</p>
                  <div className="flex flex-wrap gap-2">
                    {[{ label: "なし", val: 0 }, { label: "あり", val: 1 }].map((o) => (
                      <button key={o.val} type="button" onClick={() => updateOhCalc("contracture", o.val)} className={`px-3 py-1.5 text-xs rounded-lg border ${ohCalc.contracture === o.val ? "bg-indigo-500 text-white border-indigo-500" : "bg-white hover:bg-gray-50"}`} style={{ borderColor: ohCalc.contracture === o.val ? undefined : "rgba(0,0,0,0.1)" }}>{o.label}（{o.val}）</button>
                    ))}
                  </div>
                </div>
                {Object.values(ohCalc).every((v) => v !== null) && (
                  <div className="pt-2 border-t" style={{ borderColor: "rgba(99, 102, 241, 0.2)" }}>
                    <p className="text-xs">
                      合計: <strong>{((ohCalc.mobility ?? 0) + (ohCalc.bonyProminence ?? 0) + (ohCalc.edema ?? 0) + (ohCalc.contracture ?? 0)).toFixed(1)}</strong> 点
                      （四捨五入で <strong>{Math.round((ohCalc.mobility ?? 0) + (ohCalc.bonyProminence ?? 0) + (ohCalc.edema ?? 0) + (ohCalc.contracture ?? 0))}</strong> 点を上の欄に反映）
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* 危険因子 */}
          <section className="card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>危険因子評価（7項目）</h2>
              <button type="button" onClick={() => toggleHelp("riskFactor")} className="text-xs flex items-center gap-1 px-2 py-1 rounded border hover:bg-gray-50" style={{ borderColor: "rgba(0,0,0,0.1)", color: "var(--text-muted)" }}>
                <HelpCircle size={12} />
                {helpOpen["riskFactor"] ? "基準を閉じる" : "判定基準を見る"}
              </button>
            </div>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>1項目でも「あり／できない」なら看護計画立案が必須</p>
            {helpOpen["riskFactor"] && <RiskFactorGeneralHelp />}
            <div className="space-y-3">
              {RISK_FACTORS.map((f) => (
                <div key={f.key} className="space-y-2">
                  <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                    <div className="flex-1 flex items-center gap-2">
                      <label className="text-sm" style={{ color: "var(--text-secondary)" }}>{f.label}</label>
                      <button type="button" onClick={() => toggleRiskHint(f.key)} className="text-xs hover:text-blue-600 flex-shrink-0" style={{ color: "var(--text-muted)" }} aria-label="判断のヒント">
                        <HelpCircle size={14} />
                      </button>
                    </div>
                    <div className="flex gap-2">
                      {f.options.map((opt) => (
                        <button key={opt} type="button" onClick={() => setRiskFactors({ ...riskFactors, [f.key]: opt })}
                          className={`px-3 py-1.5 text-xs rounded-lg border transition ${
                            riskFactors[f.key] === opt
                              ? opt === "あり" || opt === "できない" ? "bg-orange-500 text-white border-orange-500" : "bg-emerald-500 text-white border-emerald-500"
                              : "bg-white hover:bg-gray-50"
                          }`}
                          style={{ borderColor: riskFactors[f.key] === opt ? undefined : "rgba(0,0,0,0.1)" }}>
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>
                  {riskFactorHintOpen[f.key] && (
                    <div className="p-3 rounded text-xs animate-fade-in" style={{ background: "rgba(56, 189, 248, 0.08)", color: "var(--text-secondary)" }}>
                      💡 {RISK_FACTOR_HINTS[f.key]}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {hasAnyRiskFactor && (
              <p className="text-xs mt-2" style={{ color: "#E65100" }}>⚠ 1項目以上に該当あり → 看護計画立案が必須</p>
            )}
          </section>

          {/* 現在の褥瘡 */}
          <section className="card p-5 space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>現在の褥瘡</h2>
            <div className="flex gap-2">
              <button type="button" onClick={() => { setHasCurrentUlcer(false); setCurrentLocations([]); setCurrentOtherDetail(""); setDesignR({}); }} className={`px-4 py-2 text-sm rounded-lg border transition ${!hasCurrentUlcer ? "bg-emerald-500 text-white border-emerald-500" : "bg-white hover:bg-gray-50"}`} style={{ borderColor: !hasCurrentUlcer ? undefined : "rgba(0,0,0,0.1)" }}>なし</button>
              <button type="button" onClick={() => setHasCurrentUlcer(true)} className={`px-4 py-2 text-sm rounded-lg border transition ${hasCurrentUlcer ? "bg-orange-500 text-white border-orange-500" : "bg-white hover:bg-gray-50"}`} style={{ borderColor: hasCurrentUlcer ? undefined : "rgba(0,0,0,0.1)" }}>あり</button>
            </div>
            {hasCurrentUlcer && (
              <div className="space-y-3 pt-2">
                <div>
                  <label className="block text-xs mb-2" style={{ color: "var(--text-muted)" }}>部位（複数選択可）</label>
                  <div className="flex flex-wrap gap-2">
                    {ULCER_LOCATIONS.map((loc) => (
                      <button key={loc} type="button" onClick={() => toggleCurrentLocation(loc)} className={`px-3 py-1.5 text-xs rounded-lg border transition ${currentLocations.includes(loc) ? "bg-blue-500 text-white border-blue-500" : "bg-white hover:bg-gray-50"}`} style={{ borderColor: currentLocations.includes(loc) ? undefined : "rgba(0,0,0,0.1)" }}>{loc}</button>
                    ))}
                  </div>
                  {currentLocations.includes("その他") && (
                    <div className="mt-2 animate-fade-in">
                      <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>その他の部位（具体的に記入）<span className="text-red-500">*</span></label>
                      <input type="text" value={currentOtherDetail} onChange={(e) => setCurrentOtherDetail(e.target.value)} placeholder="例: 右肩甲骨部・後頭部 など" className="w-full px-3 py-2 border rounded-lg text-sm" style={{ borderColor: "rgba(0,0,0,0.1)" }} />
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>発生日</label>
                  <input type="date" value={currentOnsetDate} onChange={(e) => setCurrentOnsetDate(e.target.value)} className="w-full sm:w-48 px-3 py-2 border rounded-lg text-sm" style={{ borderColor: "rgba(0,0,0,0.1)" }} />
                </div>
              </div>
            )}
          </section>

          {/* 過去の褥瘡 */}
          <section className="card p-5 space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>過去の褥瘡</h2>
            <div className="flex gap-2">
              <button type="button" onClick={() => { setHasPastUlcer(false); setPastLocations([]); setPastOtherDetail(""); }} className={`px-4 py-2 text-sm rounded-lg border transition ${!hasPastUlcer ? "bg-emerald-500 text-white border-emerald-500" : "bg-white hover:bg-gray-50"}`} style={{ borderColor: !hasPastUlcer ? undefined : "rgba(0,0,0,0.1)" }}>なし</button>
              <button type="button" onClick={() => setHasPastUlcer(true)} className={`px-4 py-2 text-sm rounded-lg border transition ${hasPastUlcer ? "bg-orange-500 text-white border-orange-500" : "bg-white hover:bg-gray-50"}`} style={{ borderColor: hasPastUlcer ? undefined : "rgba(0,0,0,0.1)" }}>あり</button>
            </div>
            {hasPastUlcer && (
              <div className="space-y-3 pt-2">
                <div>
                  <label className="block text-xs mb-2" style={{ color: "var(--text-muted)" }}>部位（複数選択可）</label>
                  <div className="flex flex-wrap gap-2">
                    {ULCER_LOCATIONS.map((loc) => (
                      <button key={loc} type="button" onClick={() => togglePastLocation(loc)} className={`px-3 py-1.5 text-xs rounded-lg border transition ${pastLocations.includes(loc) ? "bg-blue-500 text-white border-blue-500" : "bg-white hover:bg-gray-50"}`} style={{ borderColor: pastLocations.includes(loc) ? undefined : "rgba(0,0,0,0.1)" }}>{loc}</button>
                    ))}
                  </div>
                  {pastLocations.includes("その他") && (
                    <div className="mt-2 animate-fade-in">
                      <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>その他の部位（具体的に記入）<span className="text-red-500">*</span></label>
                      <input type="text" value={pastOtherDetail} onChange={(e) => setPastOtherDetail(e.target.value)} placeholder="例: 右肩甲骨部・後頭部 など" className="w-full px-3 py-2 border rounded-lg text-sm" style={{ borderColor: "rgba(0,0,0,0.1)" }} />
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>治癒日</label>
                  <input type="date" value={pastHealedDate} onChange={(e) => setPastHealedDate(e.target.value)} className="w-full sm:w-48 px-3 py-2 border rounded-lg text-sm" style={{ borderColor: "rgba(0,0,0,0.1)" }} />
                </div>
              </div>
            )}
          </section>

          {/* DESIGN-R */}
          {hasCurrentUlcer && (
            <section className="card p-5 space-y-3" style={{ borderLeft: "4px solid #FFC107" }}>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>DESIGN-R®2020 採点<span className="ml-2 text-xs font-normal" style={{ color: "#E65100" }}>（看護師手入力・AI不可）</span></h2>
                <button type="button" onClick={() => toggleHelp("designR")} className="text-xs flex items-center gap-1 px-2 py-1 rounded border hover:bg-gray-50" style={{ borderColor: "rgba(0,0,0,0.1)", color: "var(--text-muted)" }}>
                  <HelpCircle size={12} />
                  {helpOpen["designR"] ? "基準を閉じる" : "判定基準を見る"}
                </button>
              </div>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>観察・触診に基づき採点してください。小文字=軽症、大文字=重症。</p>
              {helpOpen["designR"] && <DesignRHelp />}
              <div className="grid grid-cols-1 gap-3">
                {(Object.keys(DESIGN_R_OPTIONS) as Array<keyof typeof DESIGN_R_OPTIONS>).map((key) => (
                  <div key={key}>
                    <label className="block text-xs mb-2" style={{ color: "var(--text-muted)" }}>{DESIGN_R_OPTIONS[key].label}</label>
                    <div className="flex flex-wrap gap-2">
                      {DESIGN_R_OPTIONS[key].items.map((item) => (
                        <button key={item} type="button" onClick={() => setDesignR({ ...designR, [key]: designR[key] === item ? undefined : item })}
                          className={`px-2.5 py-1 text-xs rounded border transition ${
                            designR[key] === item
                              ? item[0] === item[0].toUpperCase() && item !== "d0" && item !== "d1" && item !== "d2" ? "bg-red-500 text-white border-red-500" : "bg-blue-500 text-white border-blue-500"
                              : "bg-white hover:bg-gray-50"
                          }`}
                          style={{ borderColor: designR[key] === item ? undefined : "rgba(0,0,0,0.1)" }}>
                          {item}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* AI生成ボタン */}
          <section className="space-y-3">
            <button type="button" onClick={handleGenerate} disabled={!canProceed || generating} className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed">
              {generating ? (
                <><Loader2 size={20} className="animate-spin" />AI生成中...（最大60秒）</>
              ) : (
                <><Sparkles size={20} />{hasAnyDraft ? "AIで再生成する" : "AIで看護計画ドラフトを生成"}</>
              )}
            </button>
            {aiError && (
              <div className="p-3 rounded-lg text-sm" style={{ background: "rgba(239, 68, 68, 0.1)", color: "#B91C1C" }}>⚠ {aiError}</div>
            )}
            {!canProceed && (needsCurrentOtherDetail || needsPastOtherDetail) && (
              <p className="text-xs text-center" style={{ color: "#E65100" }}>※ 「その他」の部位を具体的に記入してください</p>
            )}
            {!canProceed && !needsCurrentOtherDetail && !needsPastOtherDetail && (
              <p className="text-xs text-center" style={{ color: "var(--text-muted)" }}>※ 日常生活自立度（B1以上）とOHスケール点数の入力が必要です</p>
            )}
          </section>

          {/* AIドラフト表示 */}
          {hasAnyDraft && (
            <section id="ai-draft" className="space-y-4" style={{ scrollMarginTop: "80px" }}>
              <div className="card p-4" style={{ background: "rgba(56, 189, 248, 0.08)", borderLeft: "4px solid #0284C7" }}>
                <div className="flex gap-2 items-start">
                  <Sparkles size={18} style={{ color: "#0284C7", flexShrink: 0, marginTop: 2 }} />
                  <div className="text-sm">
                    <p className="font-semibold mb-1" style={{ color: "#0369A1" }}>AIドラフト（※必ず看護師が確認・修正してください）</p>
                    <p style={{ color: "var(--text-secondary)" }}>各項目は編集可能です。カイポケへの転記用に項目別コピーボタンを用意しています。</p>
                    {aiModel && (<p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>モデル: {aiModel} / プロンプト: {aiPromptVersion}</p>)}
                  </div>
                </div>
              </div>
              <div className="card p-4">
                <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>次回評価日（推奨）</label>
                <input type="date" value={nextReviewDate} onChange={(e) => setNextReviewDate(e.target.value)} className="w-full sm:w-48 px-3 py-2 border rounded-lg text-sm" style={{ borderColor: "rgba(0,0,0,0.1)" }} />
              </div>
              {[
                { key: "plan_bed", label: "① 圧迫・ズレ力：ベッド上", value: planBed, setter: setPlanBed },
                { key: "plan_chair", label: "② 圧迫・ズレ力：イス上", value: planChair, setter: setPlanChair },
                { key: "plan_skincare", label: "③ スキンケア", value: planSkincare, setter: setPlanSkincare },
                { key: "plan_nutrition", label: "④ 栄養状態改善", value: planNutrition, setter: setPlanNutrition },
                { key: "plan_rehab", label: "⑤ リハビリテーション", value: planRehab, setter: setPlanRehab },
              ].map(({ key, label, value, setter }) => (
                <div key={key} className="card p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{label}</h3>
                    <button type="button" onClick={() => handleCopy(key, value)} disabled={!value.trim()} className={`btn-copy ${copiedKey === key ? "btn-copy-success" : ""} disabled:opacity-40 disabled:cursor-not-allowed`}>
                      <Copy size={14} />
                      {copiedKey === key ? "コピー済！" : "コピー"}
                    </button>
                  </div>
                  <textarea value={value} onChange={(e) => setter(e.target.value)} rows={8} maxLength={1000} className="w-full px-3 py-2 border rounded-lg text-sm leading-relaxed" style={{ borderColor: "rgba(0,0,0,0.1)" }} />
                  <div className="text-xs text-right" style={{ color: value.length > 900 ? "#DC2626" : "var(--text-muted)" }}>
                    {value.length} / 1000字
                  </div>
                </div>
              ))}
            </section>
          )}

          {/* 保存ボタン群 */}
          <section className="space-y-3">
            {/* 下書き保存 */}
            <button type="button" onClick={handleSaveDraft} disabled={!canProceed || savingDraft || saving} className="btn-outline w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed">
              {savingDraft ? (
                <><Loader2 size={18} className="animate-spin" />保存中...</>
              ) : (
                <><FileEdit size={18} />下書き保存（後で再編集できます）</>
              )}
            </button>
            {/* 確定保存 */}
            <button type="button" onClick={handleSave} disabled={!canProceed || saving || savingDraft || !hasAnyDraft} className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed">
              {saving ? (
                <><Loader2 size={20} className="animate-spin" />保存中...</>
              ) : (
                <><Save size={20} />計画書を確定保存する</>
              )}
            </button>
            {!hasAnyDraft && (
              <p className="text-xs text-center" style={{ color: "var(--text-muted)" }}>
                ※ 確定保存はAIドラフト生成後に有効になります。途中状態は「下書き保存」で保存できます。
              </p>
            )}
            {saveError && (
              <div className="p-3 rounded-lg text-sm" style={{ background: "rgba(239, 68, 68, 0.1)", color: "#B91C1C" }}>⚠ {saveError}</div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
