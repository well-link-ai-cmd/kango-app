"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { getPatients, getRecords, saveRecord, generateId, soapToText, textToSoap, type Patient, type SoapRecord } from "@/lib/storage";
import { ArrowLeft, Sparkles, Save, AlertTriangle, MessageSquare, Check } from "lucide-react";
import Link from "next/link";

interface Soap { S: string; O: string; A: string; P: string; }
interface QuestionAnswer { question: string; answer: string; }

type Step = "input" | "questions" | "soap";

export default function NewRecordPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [patient, setPatient] = useState<Patient | null>(null);
  const [recentRecords, setRecentRecords] = useState<SoapRecord[]>([]);

  const [visitDate, setVisitDate] = useState(new Date().toISOString().slice(0, 10));
  const [rawInput, setRawInput] = useState("");

  const [alerts, setAlerts] = useState<string[]>([]);
  const [alertAnswers, setAlertAnswers] = useState<QuestionAnswer[]>([]);
  const [questionAnswers, setQuestionAnswers] = useState<QuestionAnswer[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);

  const [soap, setSoap] = useState<Soap>({ S: "", O: "", A: "", P: "" });
  const [soapText, setSoapText] = useState("");
  const [loadingSoap, setLoadingSoap] = useState(false);

  const [step, setStep] = useState<Step>("input");
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const p = (await getPatients()).find((p) => p.id === id) ?? null;
      setPatient(p);
      const records = await getRecords(id);
      setRecentRecords(records.sort((a, b) => b.visitDate.localeCompare(a.visitDate)).slice(0, 3));
    })();
  }, [id]);

  async function handleFetchQuestions() {
    if (!rawInput.trim()) { alert("訪問内容を入力してください"); return; }
    if (!patient) return;
    setLoadingQuestions(true);
    setError("");
    try {
      const res = await fetch("/api/soap/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawInput,
          previousRecords: recentRecords,
          age: patient.age,
          careLevel: patient.careLevel,
          diagnosis: patient.diagnosis,
          carePlan: patient.carePlan,
          initialSoapRecords: recentRecords.length === 0 ? patient.initialSoapRecords : undefined,
        }),
      });
      const data = await res.json();
      const fetchedAlerts: string[] = data.alerts ?? [];
      setAlerts(fetchedAlerts);
      setAlertAnswers(fetchedAlerts.map((a: string) => ({ question: a, answer: "" })));
      const qs: QuestionAnswer[] = (data.questions ?? []).map((q: string) => ({ question: q, answer: "" }));
      setQuestionAnswers(qs);
      setStep("questions");
    } catch {
      setError("確認事項の取得に失敗しました。");
    } finally {
      setLoadingQuestions(false);
    }
  }

  async function handleGenerateSoap() {
    if (!patient) return;
    setLoadingSoap(true);
    setError("");
    try {
      const res = await fetch("/api/soap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawInput,
          age: patient.age,
          careLevel: patient.careLevel,
          diagnosis: patient.diagnosis,
          carePlan: patient.carePlan,
          previousRecords: recentRecords,
          alertAnswers,
          questionAnswers,
          initialSoapRecords: recentRecords.length === 0 ? patient?.initialSoapRecords : undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "エラーが発生しました");
      }
      const data: Soap = await res.json();
      setSoap(data);
      setSoapText(soapToText(data.S, data.O, data.A, data.P));
      setStep("soap");
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setLoadingSoap(false);
    }
  }

  async function handleDirectGenerate() {
    if (!rawInput.trim()) { alert("訪問内容を入力してください"); return; }
    if (!patient) return;
    setLoadingSoap(true);
    setError("");
    try {
      const res = await fetch("/api/soap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawInput,
          age: patient.age,
          careLevel: patient.careLevel,
          diagnosis: patient.diagnosis,
          carePlan: patient.carePlan,
          initialSoapRecords: patient.initialSoapRecords,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "エラーが発生しました");
      }
      const data: Soap = await res.json();
      setSoap(data);
      setSoapText(soapToText(data.S, data.O, data.A, data.P));
      setStep("soap");
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setLoadingSoap(false);
    }
  }

  async function handleSave() {
    if (!soapText.trim()) { alert("先にSOAP生成を行ってください"); return; }
    const parsed = textToSoap(soapText);
    await saveRecord({
      id: generateId(),
      patientId: id,
      visitDate,
      rawInput,
      S: parsed.S,
      O: parsed.O,
      A: parsed.A,
      P: parsed.P,
      createdAt: new Date().toISOString(),
    });
    router.push(`/patients/${id}`);
  }

  const steps: { key: Step; label: string }[] = [
    { key: "input", label: "入力" },
    { key: "questions", label: "確認" },
    { key: "soap", label: "保存" },
  ];

  function getStepState(s: Step): "active" | "completed" | "inactive" {
    const order: Step[] = ["input", "questions", "soap"];
    const currentIdx = order.indexOf(step);
    const sIdx = order.indexOf(s);
    if (s === step) return "active";
    if (sIdx < currentIdx) return "completed";
    return "inactive";
  }

  return (
    <div className="min-h-screen relative z-[1] pb-10">
      <header className="app-header">
        <div className="app-header-inner">
          <button
            onClick={() => step === "input" ? router.push(`/patients/${id}`) : setStep(step === "soap" ? "questions" : "input")}
            className="header-back"
            aria-label="戻る"
          >
            <ArrowLeft size={22} />
          </button>
          <div className="flex-1">
            <h1>訪問記録を作成</h1>
            {patient && <p className="subtitle">{patient.name} 様</p>}
          </div>
        </div>
        {/* Step Indicator */}
        <div className="max-w-2xl mx-auto px-4 pb-3">
          <div className="step-indicator">
            {steps.map((s, i) => {
              const state = getStepState(s.key);
              return (
                <div key={s.key} className="flex items-center gap-1">
                  <div className={`step-dot ${
                    state === "active" ? "step-dot-active" :
                    state === "completed" ? "step-dot-completed" :
                    "step-dot-inactive"
                  }`}>
                    {state === "completed" ? <Check size={14} /> : i + 1}
                  </div>
                  <span className="text-xs ml-1 hidden sm:inline" style={{
                    color: state === "active" ? "var(--accent-cyan)" :
                           state === "completed" ? "var(--accent-cyan)" :
                           "var(--text-muted)"
                  }}>{s.label}</span>
                  {i < steps.length - 1 && (
                    <div className={`step-connector ml-2 ${
                      state === "completed" || state === "active" ? "step-connector-active" : "step-connector-inactive"
                    }`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-5 relative z-[1]">
        {error && <div className="alert-error animate-fade-in">{error}</div>}

        {/* ===== STEP 1: Input ===== */}
        {step === "input" && (
          <div className="space-y-4 animate-fade-in-up">
            {/* Previous P alert */}
            {recentRecords.length > 0 && recentRecords[0].P && (
              <div className="alert-warning">
                <div className="flex items-center gap-2 font-semibold text-sm mb-2" style={{ color: "#CC8800" }}>
                  <AlertTriangle size={16} />
                  前回（{recentRecords[0].visitDate}）のプラン
                </div>
                <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>{recentRecords[0].P}</p>
              </div>
            )}

            {/* Visit Date */}
            <div className="card p-5">
              <label className="input-label">訪問日</label>
              <input
                type="date"
                className="input-field text-lg"
                value={visitDate}
                onChange={(e) => setVisitDate(e.target.value)}
              />
            </div>

            {/* Input Area */}
            <div className="card p-5">
              <label className="input-label">訪問内容を話し言葉で入力</label>
              <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
                バイタル・症状・処置・会話など、気になったことを自由に入力してください
              </p>
              <textarea
                rows={6}
                className="input-field text-base"
                style={{ resize: "none", lineHeight: "1.8" }}
                placeholder="例：血圧168/92でいつもより高め。本人は頭痛なし、めまいもないと言っている。足首に軽度の浮腫あり。右踵の褥瘡処置実施、滲出液少量、感染兆候なし。食欲は普通。"
                value={rawInput}
                onChange={(e) => setRawInput(e.target.value)}
              />

              {(recentRecords.length > 0 || (patient?.initialSoapRecords && patient.initialSoapRecords.length > 0)) ? (
                <button
                  onClick={handleFetchQuestions}
                  disabled={loadingQuestions}
                  className="btn-primary mt-4"
                >
                  <MessageSquare size={20} />
                  {loadingQuestions ? "確認事項を確認中..." : "AIに確認事項を聞く"}
                </button>
              ) : (
                <button
                  onClick={handleDirectGenerate}
                  disabled={loadingSoap}
                  className="btn-primary mt-4"
                >
                  <Sparkles size={20} />
                  {loadingSoap ? "AI変換中..." : "AIでSOAPに変換"}
                </button>
              )}
            </div>
          </div>
        )}

        {/* ===== STEP 2: Questions ===== */}
        {step === "questions" && (
          <div className="space-y-4 animate-fade-in-up">
            {/* Alert answers */}
            {alertAnswers.length > 0 && (
              <div className="alert-danger">
                <div className="flex items-center gap-2 font-semibold text-sm mb-3" style={{ color: "var(--accent-error)" }}>
                  <AlertTriangle size={16} />
                  前回からの継続確認事項（回答してください）
                </div>
                <div className="space-y-3">
                  {alertAnswers.map((aa, i) => (
                    <div key={i}>
                      <p className="text-sm mb-1 flex gap-2" style={{ color: "#CC3333" }}>
                        <span className="mt-0.5 shrink-0" style={{ color: "var(--accent-error)", opacity: 0.6 }}>!</span>
                        <span>{aa.question}</span>
                      </p>
                      <textarea
                        rows={2}
                        className="input-field text-sm"
                        style={{ resize: "none", borderColor: "rgba(255,68,68,0.2)" }}
                        placeholder="確認結果を入力（スキップする場合は空欄のまま）"
                        value={aa.answer}
                        onChange={(e) => {
                          const updated = [...alertAnswers];
                          updated[i] = { ...aa, answer: e.target.value };
                          setAlertAnswers(updated);
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AI Questions */}
            {questionAnswers.length > 0 && (
              <div className="card p-5">
                <h2 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
                  <MessageSquare size={16} style={{ color: "var(--accent-cyan)" }} />
                  AIからの確認質問（回答で記録が充実します）
                </h2>
                <div className="space-y-4">
                  {questionAnswers.map((qa, i) => (
                    <div key={i}>
                      <label className="block text-sm font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
                        Q{i + 1}. {qa.question}
                      </label>
                      <textarea
                        rows={2}
                        className="input-field text-sm"
                        style={{ resize: "none" }}
                        placeholder="回答を入力（スキップする場合は空欄のまま）"
                        value={qa.answer}
                        onChange={(e) => {
                          const updated = [...questionAnswers];
                          updated[i] = { ...qa, answer: e.target.value };
                          setQuestionAnswers(updated);
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={handleGenerateSoap}
              disabled={loadingSoap}
              className="btn-primary"
            >
              <Sparkles size={20} />
              {loadingSoap ? "SOAP生成中..." : "SOAPを生成する"}
            </button>
          </div>
        )}

        {/* ===== STEP 3: SOAP Confirm & Save ===== */}
        {step === "soap" && (
          <div className="card p-5 space-y-4 animate-fade-in-up">
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-secondary)" }}>SOAP記録（修正可能）</h2>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              S: O: A: P: の行頭を残したまま、内容を自由に編集できます
            </p>
            <textarea
              rows={16}
              className="input-field text-sm"
              style={{ resize: "vertical", lineHeight: "1.8", fontFamily: "inherit" }}
              value={soapText}
              onChange={(e) => setSoapText(e.target.value)}
            />
            <button onClick={handleSave} className="btn-save">
              <Save size={20} />
              記録を保存する
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
