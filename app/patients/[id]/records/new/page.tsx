"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { getPatients, getRecords, saveRecord, generateId, soapToText, textToSoap, getNursingContents, saveNursingContents, type Patient, type SoapRecord, type NursingContentItem } from "@/lib/storage";
import { ArrowLeft, Sparkles, Save, AlertTriangle, MessageSquare, Check, Plus, X } from "lucide-react";
import Link from "next/link";

interface Soap { S: string; O: string; A: string; P: string; }
interface QuestionAnswer { question: string; answer: string; }

type Step = "input" | "questions" | "soap" | "nursing-update";

export default function NewRecordPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [patient, setPatient] = useState<Patient | null>(null);
  const [recentRecords, setRecentRecords] = useState<SoapRecord[]>([]);
  const [nursingItems, setNursingItems] = useState<NursingContentItem[]>([]);

  // 保存後のケア内容自動更新
  const [diffResult, setDiffResult] = useState<{ additions: string[]; removals: string[]; reason: string } | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);

  const [visitDate, setVisitDate] = useState(new Date().toISOString().slice(0, 10));
  const [sInput, setSInput] = useState("");
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
      const nc = await getNursingContents(id);
      if (nc) setNursingItems(nc.items.filter(item => item.isActive));
    })();
  }, [id]);

  // 過去記録またはケア内容があれば確認質問を使える
  const hasContextForQuestions = recentRecords.length > 0
    || (patient?.initialSoapRecords && patient.initialSoapRecords.length > 0)
    || nursingItems.length > 0;

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
          sInput,
          rawInput,
          previousRecords: recentRecords,
          carePlan: patient.carePlan,
          nursingContentItems: nursingItems.map(item => item.text),
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
          sInput,
          rawInput,
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
          sInput,
          rawInput,
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

    // ケア内容が登録済み & 記録が3件以上ある場合のみdiff分析を実行（AIコスト削減）
    const allRecords = await getRecords(id);
    if (nursingItems.length > 0 && allRecords.length >= 3) {
      setLoadingDiff(true);
      setStep("nursing-update");
      try {
        const latest5 = allRecords.sort((a, b) => b.visitDate.localeCompare(a.visitDate)).slice(0, 5);
        const res = await fetch("/api/nursing-contents/diff", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            currentItems: nursingItems.map(item => item.text),
            records: latest5.map(r => ({ visitDate: r.visitDate, S: r.S, O: r.O, A: r.A, P: r.P })),
            carePlan: patient?.carePlan,
          }),
        });
        if (!res.ok) throw new Error("diff分析に失敗しました");
        const data = await res.json();
        if ((data.additions?.length > 0) || (data.removals?.length > 0)) {
          setDiffResult(data);
        } else {
          router.push(`/patients/${id}`);
        }
      } catch {
        // diff失敗しても記録は保存済みなので問題なし
        router.push(`/patients/${id}`);
      } finally {
        setLoadingDiff(false);
      }
    } else {
      router.push(`/patients/${id}`);
    }
  }

  async function handleAcceptAddition(text: string) {
    if (!diffResult) return;
    const newItem: NursingContentItem = {
      id: generateId(),
      text,
      isActive: true,
      source: "ai",
      addedAt: new Date().toISOString(),
    };
    const updatedItems = [...nursingItems, newItem];
    setNursingItems(updatedItems);
    setDiffResult({ ...diffResult, additions: diffResult.additions.filter(a => a !== text) });
    await saveNursingContents({ patientId: id, items: updatedItems, updatedAt: new Date().toISOString() });
  }

  async function handleAcceptRemoval(text: string) {
    if (!diffResult) return;
    const updatedItems = nursingItems.filter(item => item.text !== text);
    setNursingItems(updatedItems);
    setDiffResult({ ...diffResult, removals: diffResult.removals.filter(r => r !== text) });
    await saveNursingContents({ patientId: id, items: updatedItems, updatedAt: new Date().toISOString() });
  }

  function handleSkipDiff() {
    router.push(`/patients/${id}`);
  }

  // ケア内容がある場合のみ4ステップ表示
  const showNursingStep = nursingItems.length > 0;
  const visibleSteps: { key: Step; label: string }[] = [
    { key: "input", label: "入力" },
    { key: "questions", label: "確認" },
    { key: "soap", label: "保存" },
    ...(showNursingStep ? [{ key: "nursing-update" as Step, label: "ケア更新" }] : []),
  ];

  function getStepState(s: Step): "active" | "completed" | "inactive" {
    const order: Step[] = ["input", "questions", "soap", "nursing-update"];
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
            onClick={() => {
              if (step === "input") router.push(`/patients/${id}`);
              else if (step === "nursing-update") router.push(`/patients/${id}`);
              else if (step === "soap") setStep("questions");
              else setStep("input");
            }}
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
            {visibleSteps.map((s, i) => {
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
                  {i < visibleSteps.length - 1 && (
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

            {/* S情報 Input Area */}
            <div className="card p-5">
              <label className="input-label">S情報（利用者の発言）</label>
              <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
                利用者本人や家族の発言をそのまま入力してください。入力した内容がS情報としてそのまま使われます（医療用語の誤字のみ補正）
              </p>
              <textarea
                rows={4}
                className="input-field text-base"
                style={{ resize: "none", lineHeight: "1.8" }}
                placeholder="例：最近ちょっと足がむくんでる気がする。頭痛はないけど、夜あんまり眠れてない。ご飯は普通に食べれてるよ。"
                value={sInput}
                onChange={(e) => setSInput(e.target.value)}
              />
            </div>

            {/* 訪問内容 Input Area */}
            <div className="card p-5">
              <label className="input-label">訪問内容（今日やったこと）</label>
              <p className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>
                バイタル・処置・観察所見など、今日の訪問でやったことを話し言葉で自由に入力してください。AIがO・A・Pに整形します
              </p>
              <textarea
                rows={6}
                className="input-field text-base"
                style={{ resize: "none", lineHeight: "1.8" }}
                placeholder="例：血圧168/92でいつもより高め。足首に軽度の浮腫あり。右踵の褥瘡処置実施、滲出液少量、感染兆候なし。食欲は普通。"
                value={rawInput}
                onChange={(e) => setRawInput(e.target.value)}
              />

              {hasContextForQuestions ? (
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
                  確認事項（回答してください）
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

        {/* ===== STEP 4: Nursing Contents Update ===== */}
        {step === "nursing-update" && (
          <div className="space-y-4 animate-fade-in-up">
            {loadingDiff ? (
              <div className="card p-5 text-center">
                <Sparkles size={24} className="mx-auto mb-3" style={{ color: "var(--accent-cyan)" }} />
                <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                  記録を保存しました。ケア内容の変更を分析中...
                </p>
              </div>
            ) : diffResult && (
              <>
                <div className="card p-5">
                  <h2 className="text-sm font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
                    ケア内容の更新提案
                  </h2>
                  <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
                    {diffResult.reason}
                  </p>
                </div>

                {/* 追加提案 */}
                {diffResult.additions.length > 0 && (
                  <div className="card p-5" style={{ borderLeft: "3px solid var(--accent-cyan)" }}>
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: "var(--accent-cyan)" }}>
                      <Plus size={16} />
                      追加するケア項目
                    </h3>
                    <div className="space-y-2">
                      {diffResult.additions.map((text, i) => (
                        <div key={i} className="flex items-center justify-between gap-2 py-2 px-3" style={{
                          background: "rgba(0,200,200,0.05)",
                          borderRadius: "8px",
                        }}>
                          <span className="text-sm" style={{ color: "var(--text-primary)" }}>{text}</span>
                          <button
                            onClick={() => handleAcceptAddition(text)}
                            className="btn-outline"
                            style={{ padding: "0.25rem 0.75rem", fontSize: "0.75rem" }}
                          >
                            <Check size={14} />
                            追加
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 削除提案 */}
                {diffResult.removals.length > 0 && (
                  <div className="card p-5" style={{ borderLeft: "3px solid var(--accent-error, #e53e3e)" }}>
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: "var(--accent-error, #e53e3e)" }}>
                      <X size={16} />
                      不要になったケア項目
                    </h3>
                    <div className="space-y-2">
                      {diffResult.removals.map((text, i) => (
                        <div key={i} className="flex items-center justify-between gap-2 py-2 px-3" style={{
                          background: "rgba(255,0,0,0.03)",
                          borderRadius: "8px",
                        }}>
                          <span className="text-sm" style={{ color: "var(--text-primary)" }}>{text}</span>
                          <button
                            onClick={() => handleAcceptRemoval(text)}
                            className="btn-outline"
                            style={{ padding: "0.25rem 0.75rem", fontSize: "0.75rem", borderColor: "rgba(255,68,68,0.3)" }}
                          >
                            <X size={14} />
                            削除
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <button onClick={handleSkipDiff} className="btn-primary">
                  完了
                </button>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
