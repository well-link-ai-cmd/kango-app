"use client";

/**
 * 褥瘡計画書 新規作成ページ
 *
 * Phase 1: 看護師判定項目の入力フォーム ✅
 * Phase 2: AI生成統合 ✅
 * Phase 3: 保存機能 ✅
 */

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  getPatients,
  getRecords,
  savePressureUlcerPlan,
  type Patient,
  type DailyLifeLevel,
  type RiskFactors,
  type UlcerLocation,
  type DesignR,
  type SoapRecord,
} from "@/lib/storage";
import { ArrowLeft, AlertTriangle, Stethoscope, Sparkles, Save, Copy, Loader2 } from "lucide-react";

// AI応答型
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

// 日常生活自立度の選択肢
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

// 危険因子7項目
const RISK_FACTORS: {
  key: keyof RiskFactors;
  label: string;
  options: readonly ["できる", "できない"] | readonly ["なし", "あり"];
}[] = [
  { key: "basicMobilityBed", label: "基本的動作能力（ベッド上の自力体位変換）", options: ["できる", "できない"] as const },
  { key: "basicMobilityChair", label: "基本的動作能力（イス上の座位保持・除圧）", options: ["できる", "できない"] as const },
  { key: "bonyProminence", label: "病的骨突出", options: ["なし", "あり"] as const },
  { key: "contracture", label: "関節拘縮", options: ["なし", "あり"] as const },
  { key: "nutrition", label: "栄養状態低下", options: ["なし", "あり"] as const },
  { key: "moisture", label: "皮膚湿潤（多汗・尿失禁・便失禁）", options: ["なし", "あり"] as const },
  { key: "fragileSkin", label: "皮膚の脆弱性（浮腫・スキン-テア保有/既往）", options: ["なし", "あり"] as const },
];

// 褥瘡部位
const ULCER_LOCATIONS: UlcerLocation[] = ["仙骨部", "坐骨部", "尾骨部", "腸骨部", "大転子部", "踵部", "その他"];

// DESIGN-R 選択肢
const DESIGN_R_OPTIONS = {
  d: { label: "D（深さ）", items: ["d0", "d1", "d2", "D3", "D4", "D5", "DDTI", "DU"] },
  e: { label: "E（滲出液）", items: ["e0", "e1", "e3", "E6"] },
  s: { label: "S（大きさcm²）", items: ["s0", "s3", "s6", "s8", "s9", "s12", "S15"] },
  i: { label: "I（炎症・感染）", items: ["i0", "i1", "I3", "I3C", "I9"] },
  g: { label: "G（肉芽）", items: ["g0", "g1", "g3", "G4", "G5", "G6"] },
  n: { label: "N（壊死組織）", items: ["n0", "N3", "N6"] },
  p: { label: "P（ポケット）", items: ["p0", "P6", "P9", "P12", "P24"] },
} as const;

export default function NewPressureUlcerPlanPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  // 患者情報
  const [patient, setPatient] = useState<Patient | null>(null);
  const [recentRecords, setRecentRecords] = useState<SoapRecord[]>([]);
  const [loaded, setLoaded] = useState(false);

  // 基本情報
  const [planDate, setPlanDate] = useState(new Date().toISOString().slice(0, 10));
  const [staffName, setStaffName] = useState("");
  const [staffTitle, setStaffTitle] = useState("看護師");

  // 看護師判定項目（AI禁止領域）
  const [dailyLifeLevel, setDailyLifeLevel] = useState<DailyLifeLevel | "">("");
  const [ohScaleScore, setOhScaleScore] = useState<string>("");
  const [riskFactors, setRiskFactors] = useState<RiskFactors>({});

  // 褥瘡の有無
  const [hasCurrentUlcer, setHasCurrentUlcer] = useState(false);
  const [currentLocations, setCurrentLocations] = useState<UlcerLocation[]>([]);
  const [currentOnsetDate, setCurrentOnsetDate] = useState("");
  const [hasPastUlcer, setHasPastUlcer] = useState(false);
  const [pastLocations, setPastLocations] = useState<UlcerLocation[]>([]);
  const [pastHealedDate, setPastHealedDate] = useState("");

  // DESIGN-R（現在の褥瘡ありの場合のみ使用）
  const [designR, setDesignR] = useState<DesignR>({});

  // AI生成結果（Phase 2）
  const [generating, setGenerating] = useState(false);
  const [aiError, setAiError] = useState("");
  const [planBed, setPlanBed] = useState("");
  const [planChair, setPlanChair] = useState("");
  const [planSkincare, setPlanSkincare] = useState("");
  const [planNutrition, setPlanNutrition] = useState("");
  const [planRehab, setPlanRehab] = useState("");
  const [nextReviewDate, setNextReviewDate] = useState("");
  const [aiGeneratedAt, setAiGeneratedAt] = useState<string | undefined>(undefined);
  const [aiModel, setAiModel] = useState<string | undefined>(undefined);
  const [aiPromptVersion, setAiPromptVersion] = useState<string | undefined>(undefined);

  // 保存（Phase 3）
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const p = (await getPatients()).find((p) => p.id === id) ?? null;
      setPatient(p);
      if (p) {
        // 直近5件のSOAP記録を取得（AI生成のコンテキストに使う）
        const records = await getRecords(id);
        setRecentRecords(records.sort((a, b) => b.visitDate.localeCompare(a.visitDate)).slice(0, 5));
      }
      setLoaded(true);
    })();
  }, [id]);

  // 自立度がA2以下か判定
  const selectedLevelInfo = DAILY_LIFE_LEVELS.find((l) => l.value === dailyLifeLevel);
  const isNotApplicable = selectedLevelInfo && !selectedLevelInfo.applicable;

  // 危険因子1項目以上が「あり/できない」か
  const hasAnyRiskFactor = Object.entries(riskFactors).some(
    ([, v]) => v === "あり" || v === "できない"
  );

  // バリデーション
  const canProceed =
    !!dailyLifeLevel &&
    !isNotApplicable &&
    ohScaleScore !== "" &&
    Number(ohScaleScore) >= 0 &&
    Number(ohScaleScore) <= 10;

  function toggleCurrentLocation(loc: UlcerLocation) {
    setCurrentLocations((prev) =>
      prev.includes(loc) ? prev.filter((l) => l !== loc) : [...prev, loc]
    );
  }

  function togglePastLocation(loc: UlcerLocation) {
    setPastLocations((prev) =>
      prev.includes(loc) ? prev.filter((l) => l !== loc) : [...prev, loc]
    );
  }

  // Phase 2: AI生成
  async function handleGenerate() {
    if (!patient) return;
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
          patient: {
            age: patient.age,
            diagnosis: patient.diagnosis,
            care_level: patient.careLevel,
          },
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
          current_locations: currentLocations,
          design_r: designR,
          recent_soap_records: recentRecords.map((r) => ({
            visit_date: r.visitDate,
            S: r.S,
            O: r.O,
            A: r.A,
            P: r.P,
          })),
        }),
      });
      const data: AiPlanResponse & { error?: string } = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "AI生成に失敗しました");
      }

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

      // ドラフトセクションまでスクロール
      setTimeout(() => {
        document.getElementById("ai-draft")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "AI生成中にエラーが発生しました";
      setAiError(msg);
    } finally {
      setGenerating(false);
    }
  }

  // Phase 3: 保存
  async function handleSave() {
    if (!patient) return;
    if (!dailyLifeLevel || ohScaleScore === "") {
      alert("日常生活自立度とOHスケール点数を先に入力してください");
      return;
    }

    setSaving(true);
    setSaveError("");
    try {
      const saved = await savePressureUlcerPlan({
        patientId: patient.id,
        planDate,
        nextReviewDate: nextReviewDate || undefined,
        staffName: staffName || undefined,
        staffTitle: staffTitle || undefined,
        dailyLifeLevel: dailyLifeLevel || undefined,
        riskFactors,
        ohScaleScore: Number(ohScaleScore),
        hasCurrentUlcer,
        currentLocations,
        currentOnsetDate: currentOnsetDate || undefined,
        hasPastUlcer,
        pastLocations,
        pastHealedDate: pastHealedDate || undefined,
        designR,
        planBed: planBed || undefined,
        planChair: planChair || undefined,
        planSkincare: planSkincare || undefined,
        planNutrition: planNutrition || undefined,
        planRehab: planRehab || undefined,
        aiModel,
        aiPromptVersion,
        aiGeneratedAt,
      });
      if (!saved) {
        throw new Error("保存に失敗しました");
      }
      router.push(`/patients/${patient.id}/pressure-ulcer-plan`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "保存中にエラーが発生しました";
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  }

  // 項目別コピー（カイポケ転記用）
  function handleCopy(key: string, text: string) {
    if (!text.trim()) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  const hasAnyDraft =
    planBed.trim() || planChair.trim() || planSkincare.trim() || planNutrition.trim() || planRehab.trim();

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
            <h1>褥瘡計画書の作成</h1>
            <p className="subtitle">{patient.name} 様</p>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 relative z-[1] space-y-6">
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
              <input
                type="date"
                value={planDate}
                onChange={(e) => setPlanDate(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
                style={{ borderColor: "rgba(0,0,0,0.1)" }}
              />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>記入看護師名</label>
              <input
                type="text"
                value={staffName}
                onChange={(e) => setStaffName(e.target.value)}
                placeholder="例: 平田 花子"
                className="w-full px-3 py-2 border rounded-lg text-sm"
                style={{ borderColor: "rgba(0,0,0,0.1)" }}
              />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>肩書き</label>
              <input
                type="text"
                value={staffTitle}
                onChange={(e) => setStaffTitle(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
                style={{ borderColor: "rgba(0,0,0,0.1)" }}
              />
            </div>
          </div>
        </section>

        {/* 日常生活自立度 */}
        <section className="card p-5 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            日常生活自立度 <span className="text-red-500">*</span>
          </h2>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            A2以下は計画立案不要。B1以上で作成必須。
          </p>
          <div className="grid grid-cols-4 gap-2">
            {DAILY_LIFE_LEVELS.map((level) => (
              <button
                key={level.value}
                type="button"
                onClick={() => setDailyLifeLevel(level.value)}
                className={`px-3 py-2 text-xs rounded-lg border transition ${
                  dailyLifeLevel === level.value
                    ? level.applicable
                      ? "bg-blue-500 text-white border-blue-500"
                      : "bg-gray-400 text-white border-gray-400"
                    : "bg-white hover:bg-gray-50"
                }`}
                style={{ borderColor: dailyLifeLevel === level.value ? undefined : "rgba(0,0,0,0.1)" }}
              >
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

        {/* 自立度が該当する場合のみ、以降を表示 */}
        {dailyLifeLevel && !isNotApplicable && (
          <>
            {/* OHスケール */}
            <section className="card p-5 space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                OHスケール点数 <span className="text-red-500">*</span>
              </h2>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                0-10点。分類: 0=なし / 1-3=軽度 / 4-6=中等度 / 7-10=高度
              </p>
              <input
                type="number"
                min={0}
                max={10}
                value={ohScaleScore}
                onChange={(e) => setOhScaleScore(e.target.value)}
                placeholder="0〜10"
                className="w-full sm:w-32 px-3 py-2 border rounded-lg text-sm"
                style={{ borderColor: "rgba(0,0,0,0.1)" }}
              />
            </section>

            {/* 危険因子 */}
            <section className="card p-5 space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                危険因子評価（7項目）
              </h2>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                1項目でも「あり／できない」なら看護計画立案が必須
              </p>
              <div className="space-y-3">
                {RISK_FACTORS.map((f) => (
                  <div key={f.key} className="flex flex-col sm:flex-row gap-2 sm:items-center">
                    <label className="flex-1 text-sm" style={{ color: "var(--text-secondary)" }}>
                      {f.label}
                    </label>
                    <div className="flex gap-2">
                      {f.options.map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => setRiskFactors({ ...riskFactors, [f.key]: opt })}
                          className={`px-3 py-1.5 text-xs rounded-lg border transition ${
                            riskFactors[f.key] === opt
                              ? opt === "あり" || opt === "できない"
                                ? "bg-orange-500 text-white border-orange-500"
                                : "bg-emerald-500 text-white border-emerald-500"
                              : "bg-white hover:bg-gray-50"
                          }`}
                          style={{ borderColor: riskFactors[f.key] === opt ? undefined : "rgba(0,0,0,0.1)" }}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {hasAnyRiskFactor && (
                <p className="text-xs mt-2" style={{ color: "#E65100" }}>
                  ⚠ 1項目以上に該当あり → 看護計画立案が必須
                </p>
              )}
            </section>

            {/* 現在の褥瘡 */}
            <section className="card p-5 space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                現在の褥瘡
              </h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setHasCurrentUlcer(false); setCurrentLocations([]); setDesignR({}); }}
                  className={`px-4 py-2 text-sm rounded-lg border transition ${!hasCurrentUlcer ? "bg-emerald-500 text-white border-emerald-500" : "bg-white hover:bg-gray-50"}`}
                  style={{ borderColor: !hasCurrentUlcer ? undefined : "rgba(0,0,0,0.1)" }}
                >
                  なし
                </button>
                <button
                  type="button"
                  onClick={() => setHasCurrentUlcer(true)}
                  className={`px-4 py-2 text-sm rounded-lg border transition ${hasCurrentUlcer ? "bg-orange-500 text-white border-orange-500" : "bg-white hover:bg-gray-50"}`}
                  style={{ borderColor: hasCurrentUlcer ? undefined : "rgba(0,0,0,0.1)" }}
                >
                  あり
                </button>
              </div>
              {hasCurrentUlcer && (
                <div className="space-y-3 pt-2">
                  <div>
                    <label className="block text-xs mb-2" style={{ color: "var(--text-muted)" }}>部位（複数選択可）</label>
                    <div className="flex flex-wrap gap-2">
                      {ULCER_LOCATIONS.map((loc) => (
                        <button
                          key={loc}
                          type="button"
                          onClick={() => toggleCurrentLocation(loc)}
                          className={`px-3 py-1.5 text-xs rounded-lg border transition ${
                            currentLocations.includes(loc) ? "bg-blue-500 text-white border-blue-500" : "bg-white hover:bg-gray-50"
                          }`}
                          style={{ borderColor: currentLocations.includes(loc) ? undefined : "rgba(0,0,0,0.1)" }}
                        >
                          {loc}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>発生日</label>
                    <input
                      type="date"
                      value={currentOnsetDate}
                      onChange={(e) => setCurrentOnsetDate(e.target.value)}
                      className="w-full sm:w-48 px-3 py-2 border rounded-lg text-sm"
                      style={{ borderColor: "rgba(0,0,0,0.1)" }}
                    />
                  </div>
                </div>
              )}
            </section>

            {/* 過去の褥瘡 */}
            <section className="card p-5 space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                過去の褥瘡
              </h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setHasPastUlcer(false); setPastLocations([]); }}
                  className={`px-4 py-2 text-sm rounded-lg border transition ${!hasPastUlcer ? "bg-emerald-500 text-white border-emerald-500" : "bg-white hover:bg-gray-50"}`}
                  style={{ borderColor: !hasPastUlcer ? undefined : "rgba(0,0,0,0.1)" }}
                >
                  なし
                </button>
                <button
                  type="button"
                  onClick={() => setHasPastUlcer(true)}
                  className={`px-4 py-2 text-sm rounded-lg border transition ${hasPastUlcer ? "bg-orange-500 text-white border-orange-500" : "bg-white hover:bg-gray-50"}`}
                  style={{ borderColor: hasPastUlcer ? undefined : "rgba(0,0,0,0.1)" }}
                >
                  あり
                </button>
              </div>
              {hasPastUlcer && (
                <div className="space-y-3 pt-2">
                  <div>
                    <label className="block text-xs mb-2" style={{ color: "var(--text-muted)" }}>部位（複数選択可）</label>
                    <div className="flex flex-wrap gap-2">
                      {ULCER_LOCATIONS.map((loc) => (
                        <button
                          key={loc}
                          type="button"
                          onClick={() => togglePastLocation(loc)}
                          className={`px-3 py-1.5 text-xs rounded-lg border transition ${
                            pastLocations.includes(loc) ? "bg-blue-500 text-white border-blue-500" : "bg-white hover:bg-gray-50"
                          }`}
                          style={{ borderColor: pastLocations.includes(loc) ? undefined : "rgba(0,0,0,0.1)" }}
                        >
                          {loc}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>治癒日</label>
                    <input
                      type="date"
                      value={pastHealedDate}
                      onChange={(e) => setPastHealedDate(e.target.value)}
                      className="w-full sm:w-48 px-3 py-2 border rounded-lg text-sm"
                      style={{ borderColor: "rgba(0,0,0,0.1)" }}
                    />
                  </div>
                </div>
              )}
            </section>

            {/* DESIGN-R（現在の褥瘡ありの場合のみ） */}
            {hasCurrentUlcer && (
              <section className="card p-5 space-y-3" style={{ borderLeft: "4px solid #FFC107" }}>
                <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                  DESIGN-R®2020 採点
                  <span className="ml-2 text-xs font-normal" style={{ color: "#E65100" }}>（看護師手入力・AI不可）</span>
                </h2>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  観察・触診に基づき採点してください。小文字=軽症、大文字=重症。
                </p>
                <div className="grid grid-cols-1 gap-3">
                  {(Object.keys(DESIGN_R_OPTIONS) as Array<keyof typeof DESIGN_R_OPTIONS>).map((key) => (
                    <div key={key}>
                      <label className="block text-xs mb-2" style={{ color: "var(--text-muted)" }}>
                        {DESIGN_R_OPTIONS[key].label}
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {DESIGN_R_OPTIONS[key].items.map((item) => (
                          <button
                            key={item}
                            type="button"
                            onClick={() =>
                              setDesignR({ ...designR, [key]: designR[key] === item ? undefined : item })
                            }
                            className={`px-2.5 py-1 text-xs rounded border transition ${
                              designR[key] === item
                                ? item[0] === item[0].toUpperCase() && item !== "d0" && item !== "d1" && item !== "d2"
                                  ? "bg-red-500 text-white border-red-500"
                                  : "bg-blue-500 text-white border-blue-500"
                                : "bg-white hover:bg-gray-50"
                            }`}
                            style={{ borderColor: designR[key] === item ? undefined : "rgba(0,0,0,0.1)" }}
                          >
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
              <button
                type="button"
                onClick={handleGenerate}
                disabled={!canProceed || generating}
                className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generating ? (
                  <>
                    <Loader2 size={20} className="animate-spin" />
                    AI生成中...（最大30秒）
                  </>
                ) : (
                  <>
                    <Sparkles size={20} />
                    {hasAnyDraft ? "AIで再生成する" : "AIで看護計画ドラフトを生成"}
                  </>
                )}
              </button>
              {aiError && (
                <div className="p-3 rounded-lg text-sm" style={{ background: "rgba(239, 68, 68, 0.1)", color: "#B91C1C" }}>
                  ⚠ {aiError}
                </div>
              )}
              {!canProceed && (
                <p className="text-xs text-center" style={{ color: "var(--text-muted)" }}>
                  ※ 日常生活自立度（B1以上）とOHスケール点数の入力が必要です
                </p>
              )}
            </section>

            {/* AIドラフト表示（5軸） */}
            {hasAnyDraft && (
              <section id="ai-draft" className="space-y-4" style={{ scrollMarginTop: "80px" }}>
                <div className="card p-4" style={{ background: "rgba(56, 189, 248, 0.08)", borderLeft: "4px solid #0284C7" }}>
                  <div className="flex gap-2 items-start">
                    <Sparkles size={18} style={{ color: "#0284C7", flexShrink: 0, marginTop: 2 }} />
                    <div className="text-sm">
                      <p className="font-semibold mb-1" style={{ color: "#0369A1" }}>AIドラフト（※必ず看護師が確認・修正してください）</p>
                      <p style={{ color: "var(--text-secondary)" }}>
                        各項目は編集可能です。カイポケへの転記用に項目別コピーボタンを用意しています。
                      </p>
                      {aiModel && (
                        <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                          モデル: {aiModel} / プロンプト: {aiPromptVersion}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* 次回評価日 */}
                <div className="card p-4">
                  <label className="block text-xs mb-1" style={{ color: "var(--text-muted)" }}>次回評価日（推奨）</label>
                  <input
                    type="date"
                    value={nextReviewDate}
                    onChange={(e) => setNextReviewDate(e.target.value)}
                    className="w-full sm:w-48 px-3 py-2 border rounded-lg text-sm"
                    style={{ borderColor: "rgba(0,0,0,0.1)" }}
                  />
                </div>

                {/* 5軸 */}
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
                      rows={8}
                      maxLength={1000}
                      className="w-full px-3 py-2 border rounded-lg text-sm leading-relaxed"
                      style={{ borderColor: "rgba(0,0,0,0.1)" }}
                    />
                    <div className="text-xs text-right" style={{ color: value.length > 900 ? "#DC2626" : "var(--text-muted)" }}>
                      {value.length} / 1000字
                    </div>
                  </div>
                ))}
              </section>
            )}

            {/* 保存ボタン */}
            <section className="space-y-3">
              <button
                type="button"
                onClick={handleSave}
                disabled={!canProceed || saving}
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
                    計画書を保存する
                  </>
                )}
              </button>
              {saveError && (
                <div className="p-3 rounded-lg text-sm" style={{ background: "rgba(239, 68, 68, 0.1)", color: "#B91C1C" }}>
                  ⚠ {saveError}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
