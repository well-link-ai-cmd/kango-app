"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  getPatients, getRecords, getNursingContents, saveNursingContents, generateId,
  type Patient, type SoapRecord, type NursingContents, type NursingContentItem,
} from "@/lib/storage";
import { ArrowLeft, Plus, Trash2, Sparkles, RefreshCw, Check, X } from "lucide-react";

export default function NursingContentsPage() {
  const { id } = useParams<{ id: string }>();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [contents, setContents] = useState<NursingContents | null>(null);
  const [records, setRecords] = useState<SoapRecord[]>([]);
  const [newItemText, setNewItemText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // AI差分分析の結果
  const [diffResult, setDiffResult] = useState<{
    additions: string[];
    removals: string[];
    reason: string;
  } | null>(null);

  // AI初回抽出のプレビュー
  const [extractPreview, setExtractPreview] = useState<string[] | null>(null);

  useEffect(() => {
    (async () => {
      const p = (await getPatients()).find((p) => p.id === id) ?? null;
      setPatient(p);
      setContents(await getNursingContents(id));
      const recs = await getRecords(id);
      setRecords(recs.sort((a, b) => b.visitDate.localeCompare(a.visitDate)));
    })();
  }, [id]);

  // 保存ヘルパー
  async function updateContents(items: NursingContentItem[]) {
    const updated: NursingContents = {
      patientId: id,
      items,
      lastAnalyzedAt: contents?.lastAnalyzedAt,
      updatedAt: new Date().toISOString(),
    };
    await saveNursingContents(updated);
    setContents(updated);
  }

  // 手動追加
  async function handleAddItem() {
    if (!newItemText.trim()) return;
    const newItem: NursingContentItem = {
      id: generateId(),
      text: newItemText.trim(),
      isActive: true,
      source: "manual",
      addedAt: new Date().toISOString(),
    };
    const items = [...(contents?.items ?? []), newItem];
    await updateContents(items);
    setNewItemText("");
  }

  // 項目削除
  async function handleDeleteItem(itemId: string) {
    if (!contents) return;
    const items = contents.items.filter((i) => i.id !== itemId);
    await updateContents(items);
  }

  // AI初回抽出
  async function handleExtract() {
    if (records.length === 0) {
      setError("記録がありません。先に訪問記録を作成してください。");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/nursing-contents/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          records: records.slice(0, 5).map((r) => ({
            visitDate: r.visitDate, S: r.S, O: r.O, A: r.A, P: r.P,
          })),
          carePlan: patient?.carePlan,
          diagnosis: patient?.diagnosis,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setExtractPreview(data.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI処理に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  // 抽出結果を確定
  async function handleConfirmExtract() {
    if (!extractPreview) return;
    const items: NursingContentItem[] = extractPreview.map((text) => ({
      id: generateId(),
      text,
      isActive: true,
      source: "ai" as const,
      addedAt: new Date().toISOString(),
    }));
    const updated: NursingContents = {
      patientId: id,
      items,
      lastAnalyzedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveNursingContents(updated);
    setContents(updated);
    setExtractPreview(null);
  }

  // AI差分分析
  async function handleDiffAnalysis() {
    if (records.length === 0) {
      setError("記録がありません");
      return;
    }
    setLoading(true);
    setError("");
    setDiffResult(null);
    try {
      const res = await fetch("/api/nursing-contents/diff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentItems: contents?.items.map((i) => i.text) ?? [],
          records: records.slice(0, 5).map((r) => ({
            visitDate: r.visitDate, S: r.S, O: r.O, A: r.A, P: r.P,
          })),
          carePlan: patient?.carePlan,
          diagnosis: patient?.diagnosis,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDiffResult(data);
      // lastAnalyzedAtを更新
      if (contents) {
        const updated = { ...contents, lastAnalyzedAt: new Date().toISOString() };
        await saveNursingContents(updated);
        setContents(updated);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI処理に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  // 差分の追加候補を承認
  async function handleAcceptAddition(text: string) {
    const newItem: NursingContentItem = {
      id: generateId(),
      text,
      isActive: true,
      source: "ai",
      addedAt: new Date().toISOString(),
    };
    const items = [...(contents?.items ?? []), newItem];
    await updateContents(items);
    setDiffResult((prev) =>
      prev ? { ...prev, additions: prev.additions.filter((a) => a !== text) } : null
    );
  }

  // 差分の削除候補を承認
  async function handleAcceptRemoval(text: string) {
    if (!contents) return;
    const items = contents.items.filter((i) => i.text !== text);
    await updateContents(items);
    setDiffResult((prev) =>
      prev ? { ...prev, removals: prev.removals.filter((r) => r !== text) } : null
    );
  }

  if (!patient) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ color: "var(--text-muted)" }}>
        読み込み中...
      </div>
    );
  }

  const hasContents = contents && contents.items.length > 0;

  return (
    <div className="min-h-screen relative z-[1] pb-10">
      <header className="app-header">
        <div className="app-header-inner">
          <Link href={`/patients/${id}`} className="header-back" aria-label="戻る">
            <ArrowLeft size={22} />
          </Link>
          <div className="flex-1">
            <h1>看護内容リスト</h1>
            <p className="subtitle">{patient.name} 様</p>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 relative z-[1] space-y-4">
        {error && (
          <div className="alert-error animate-fade-in">{error}</div>
        )}

        {/* 未登録時：初回セットアップ */}
        {!hasContents && !extractPreview && (
          <div className="card p-6 text-center space-y-4 animate-fade-in-up">
            <div style={{ color: "var(--accent-cyan)" }}>
              <Sparkles size={40} className="mx-auto mb-2" />
            </div>
            <p className="font-semibold text-lg" style={{ color: "var(--text-primary)" }}>
              看護内容を登録しましょう
            </p>
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              訪問時に何をするかをリスト化しておくと、初めて訪問する看護師でもすぐに把握できます
            </p>
            {records.length > 0 && (
              <button
                onClick={handleExtract}
                disabled={loading}
                className="btn-primary"
              >
                <Sparkles size={18} />
                {loading ? "AI分析中..." : "直近の記録からAIで自動抽出する"}
              </button>
            )}
            <button
              onClick={async () => {
                // 空のコンテンツを作成して編集モードへ
                const empty: NursingContents = {
                  patientId: id,
                  items: [],
                  updatedAt: new Date().toISOString(),
                };
                await saveNursingContents(empty);
                setContents(empty);
              }}
              className="btn-outline"
            >
              手動で登録する
            </button>
            {records.length === 0 && (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                訪問記録を作成すると、AIが自動で看護内容を抽出できるようになります
              </p>
            )}
          </div>
        )}

        {/* AI抽出プレビュー */}
        {extractPreview && (
          <div className="card p-5 space-y-4 animate-fade-in-up">
            <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
              AIが抽出した看護内容（{extractPreview.length}件）
            </p>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              確認して登録してください。登録後に手動で追加・削除できます。
            </p>
            <ul className="space-y-2">
              {extractPreview.map((item, i) => (
                <li
                  key={i}
                  className="flex items-center gap-3 p-3 rounded-lg"
                  style={{ background: "var(--bg-tertiary)" }}
                >
                  <Check size={16} style={{ color: "var(--accent-success)" }} />
                  <span className="text-sm" style={{ color: "var(--text-primary)" }}>{item}</span>
                </li>
              ))}
            </ul>
            <div className="flex gap-3">
              <button onClick={handleConfirmExtract} className="btn-save flex-1">
                この内容で登録する
              </button>
              <button
                onClick={() => setExtractPreview(null)}
                className="btn-outline"
              >
                やめる
              </button>
            </div>
          </div>
        )}

        {/* 登録済み：看護内容リスト */}
        {hasContents && (
          <>
            <div className="card overflow-hidden animate-fade-in-up">
              <div className="px-5 py-4" style={{ borderBottom: "1px solid rgba(0,0,0,0.04)" }}>
                <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
                  登録済みケア項目（{contents.items.length}件）
                </p>
              </div>
              <ul>
                {contents.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-3 px-5 py-3"
                    style={{ borderBottom: "1px solid rgba(0,0,0,0.03)" }}
                  >
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: "var(--accent-cyan)" }}
                    />
                    <span className="flex-1 text-sm" style={{ color: "var(--text-primary)" }}>
                      {item.text}
                    </span>
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      {item.source === "ai" ? "AI" : "手動"}
                    </span>
                    <button
                      onClick={() => handleDeleteItem(item.id)}
                      className="btn-delete"
                      aria-label="削除"
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {/* 手動追加フォーム */}
            <div className="card p-5 animate-fade-in-up">
              <p className="input-label">ケア項目を追加</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="input-field flex-1"
                  placeholder="例：排便コントロールの確認"
                  value={newItemText}
                  onChange={(e) => setNewItemText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); handleAddItem(); }
                  }}
                />
                <button
                  onClick={handleAddItem}
                  disabled={!newItemText.trim()}
                  className="btn-outline"
                  style={{ borderRadius: "12px" }}
                >
                  <Plus size={16} />
                  追加
                </button>
              </div>
            </div>

            {/* AI差分分析 */}
            {records.length > 0 && (
              <div className="card p-5 space-y-3 animate-fade-in-up">
                <button
                  onClick={handleDiffAnalysis}
                  disabled={loading}
                  className="btn-outline w-full justify-center"
                >
                  <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                  {loading ? "AI分析中..." : "AIで記録を分析する"}
                </button>
                {contents.lastAnalyzedAt && (
                  <p className="text-xs text-center" style={{ color: "var(--text-muted)" }}>
                    最終分析：{new Date(contents.lastAnalyzedAt).toLocaleDateString("ja-JP")}
                  </p>
                )}
              </div>
            )}

            {/* 差分分析結果 */}
            {diffResult && (
              <div className="card p-5 space-y-4 animate-fade-in-up">
                <p className="font-semibold" style={{ color: "var(--text-primary)" }}>AI分析結果</p>
                {diffResult.reason && (
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>{diffResult.reason}</p>
                )}

                {diffResult.additions.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold" style={{ color: "var(--accent-success)" }}>追加候補</p>
                    {diffResult.additions.map((text, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 p-3 rounded-lg"
                        style={{ background: "rgba(0, 200, 150, 0.05)", border: "1px solid rgba(0, 200, 150, 0.15)" }}
                      >
                        <span className="flex-1 text-sm" style={{ color: "var(--text-primary)" }}>{text}</span>
                        <button onClick={() => handleAcceptAddition(text)} className="btn-quick" style={{ color: "var(--accent-success)", borderColor: "var(--accent-success)" }}>
                          <Check size={14} /> 追加
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {diffResult.removals.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold" style={{ color: "var(--accent-error)" }}>削除候補</p>
                    {diffResult.removals.map((text, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 p-3 rounded-lg"
                        style={{ background: "rgba(255, 68, 68, 0.04)", border: "1px solid rgba(255, 68, 68, 0.15)" }}
                      >
                        <span className="flex-1 text-sm" style={{ color: "var(--text-primary)" }}>{text}</span>
                        <button onClick={() => handleAcceptRemoval(text)} className="btn-quick" style={{ color: "var(--accent-error)", borderColor: "var(--accent-error)" }}>
                          <X size={14} /> 削除
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {diffResult.additions.length === 0 && diffResult.removals.length === 0 && (
                  <p className="text-sm text-center" style={{ color: "var(--text-muted)" }}>
                    現在のリストは最新の記録内容と一致しています
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {/* コンテンツは作成済みだが項目が0件（手動モードで開始した場合） */}
        {contents && contents.items.length === 0 && !extractPreview && (
          <div className="card p-5 animate-fade-in-up">
            <p className="input-label">ケア項目を追加</p>
            <div className="flex gap-2">
              <input
                type="text"
                className="input-field flex-1"
                placeholder="例：バイタル測定（血圧・脈拍・体温・SpO2）"
                value={newItemText}
                onChange={(e) => setNewItemText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); handleAddItem(); }
                }}
              />
              <button
                onClick={handleAddItem}
                disabled={!newItemText.trim()}
                className="btn-outline"
                style={{ borderRadius: "12px" }}
              >
                <Plus size={16} />
                追加
              </button>
            </div>
            {records.length > 0 && (
              <button
                onClick={handleExtract}
                disabled={loading}
                className="btn-outline w-full justify-center mt-3"
              >
                <Sparkles size={16} />
                {loading ? "AI分析中..." : "AIで自動抽出する"}
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
