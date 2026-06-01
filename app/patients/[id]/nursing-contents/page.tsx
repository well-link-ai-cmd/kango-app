"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  getPatients, getRecords, getNursingContents, saveNursingContents, generateId,
  type Patient, type SoapRecord, type NursingContents, type NursingContentItem,
} from "@/lib/storage";
import { ArrowLeft, Plus, Trash2, Sparkles, RefreshCw, Check, X, Home, Pencil, Save } from "lucide-react";

export default function NursingContentsPage() {
  const { id } = useParams<{ id: string }>();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [contents, setContents] = useState<NursingContents | null>(null);
  const [records, setRecords] = useState<SoapRecord[]>([]);
  const [newItemsText, setNewItemsText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  const [diffResult, setDiffResult] = useState<{
    additions: string[];
    removals: string[];
    reason: string;
  } | null>(null);

  const [editingAdditionIndex, setEditingAdditionIndex] = useState<number | null>(null);
  const [editingAdditionText, setEditingAdditionText] = useState("");
  const [editingRemovalIndex, setEditingRemovalIndex] = useState<number | null>(null);
  const [editingRemovalText, setEditingRemovalText] = useState("");

  const [extractPreview, setExtractPreview] = useState<string[] | null>(null);
  const [editingPreviewIndex, setEditingPreviewIndex] = useState<number | null>(null);
  const [editingPreviewText, setEditingPreviewText] = useState("");

  useEffect(() => {
    (async () => {
      const p = (await getPatients()).find((p) => p.id === id) ?? null;
      setPatient(p);
      setContents(await getNursingContents(id));
      const recs = await getRecords(id);
      setRecords(recs.sort((a, b) => b.visitDate.localeCompare(a.visitDate)));
    })();
  }, [id]);

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

  function parseInputLines(raw: string): string[] {
    return raw
      .split("\n")
      .map((line) =>
        line
          .trim()
          .replace(/^[・•\-＊\*\+]\s*/, "")
          .replace(/^\d+[\.\)]\s*/, "")
          .trim()
      )
      .filter((line) => line.length > 0);
  }

  async function handleAddItems() {
    const lines = parseInputLines(newItemsText);
    if (lines.length === 0) return;
    const now = new Date().toISOString();
    const newItems: NursingContentItem[] = lines.map((text) => ({
      id: generateId(),
      text,
      isActive: true,
      source: "manual" as const,
      addedAt: now,
    }));
    const items = [...(contents?.items ?? []), ...newItems];
    await updateContents(items);
    setNewItemsText("");
  }

  async function handleDeleteItem(itemId: string) {
    if (!contents) return;
    const items = contents.items.filter((i) => i.id !== itemId);
    await updateContents(items);
  }

  function handleStartEdit(item: NursingContentItem) {
    setEditingItemId(item.id);
    setEditingText(item.text);
  }

  async function handleSaveEdit() {
    if (!contents || !editingItemId) return;
    const trimmed = editingText.trim();
    if (!trimmed) {
      setError("項目名は空にできません");
      return;
    }
    const items = contents.items.map((i) =>
      i.id === editingItemId ? { ...i, text: trimmed } : i
    );
    await updateContents(items);
    setEditingItemId(null);
    setEditingText("");
  }

  function handleCancelEdit() {
    setEditingItemId(null);
    setEditingText("");
  }

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

  function handleStartEditPreview(index: number, text: string) {
    setEditingPreviewIndex(index);
    setEditingPreviewText(text);
  }

  function handleSavePreviewEdit(index: number) {
    if (!extractPreview) return;
    const trimmed = editingPreviewText.trim();
    if (!trimmed) {
      setError("項目名は空にできません");
      return;
    }
    setExtractPreview(extractPreview.map((t, i) => (i === index ? trimmed : t)));
    setEditingPreviewIndex(null);
    setEditingPreviewText("");
  }

  function handleCancelPreviewEdit() {
    setEditingPreviewIndex(null);
    setEditingPreviewText("");
  }

  function handleDeletePreview(index: number) {
    if (!extractPreview) return;
    setExtractPreview(extractPreview.filter((_, i) => i !== index));
    setEditingPreviewIndex(null);
    setEditingPreviewText("");
  }

  async function handleDiffAnalysis() {
    if (records.length === 0) {
      setError("記録がありません");
      return;
    }
    setLoading(true);
    setError("");
    setDiffResult(null);
    setEditingAdditionIndex(null);
    setEditingRemovalIndex(null);
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
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDiffResult(data);
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

  async function handleAcceptAddition(index: number) {
    if (!diffResult) return;
    const text = editingAdditionIndex === index
      ? editingAdditionText.trim()
      : diffResult.additions[index];
    if (!text) {
      setError("項目名は空にできません");
      return;
    }
    const newItem: NursingContentItem = {
      id: generateId(),
      text,
      isActive: true,
      source: "ai",
      addedAt: new Date().toISOString(),
    };
    const items = [...(contents?.items ?? []), newItem];
    await updateContents(items);
    setDiffResult({
      ...diffResult,
      additions: diffResult.additions.filter((_, i) => i !== index),
    });
    if (editingAdditionIndex === index) {
      setEditingAdditionIndex(null);
      setEditingAdditionText("");
    }
  }

  function handleDismissAddition(index: number) {
    if (!diffResult) return;
    setDiffResult({
      ...diffResult,
      additions: diffResult.additions.filter((_, i) => i !== index),
    });
    if (editingAdditionIndex === index) {
      setEditingAdditionIndex(null);
      setEditingAdditionText("");
    }
  }

  function handleStartEditAddition(index: number, text: string) {
    setEditingAdditionIndex(index);
    setEditingAdditionText(text);
  }

  function handleCancelEditAddition() {
    setEditingAdditionIndex(null);
    setEditingAdditionText("");
  }

  async function handleAcceptRemoval(index: number) {
    if (!diffResult || !contents) return;
    const originalText = diffResult.removals[index];
    const items = contents.items.filter((i) => i.text !== originalText);
    await updateContents(items);
    setDiffResult({
      ...diffResult,
      removals: diffResult.removals.filter((_, i) => i !== index),
    });
    if (editingRemovalIndex === index) {
      setEditingRemovalIndex(null);
      setEditingRemovalText("");
    }
  }

  async function handleKeepWithEdit(index: number) {
    if (!diffResult || !contents) return;
    const originalText = diffResult.removals[index];
    const newText = editingRemovalText.trim();
    if (!newText) {
      setError("項目名は空にできません");
      return;
    }
    const items = contents.items.map((i) =>
      i.text === originalText ? { ...i, text: newText } : i
    );
    await updateContents(items);
    setDiffResult({
      ...diffResult,
      removals: diffResult.removals.filter((_, i) => i !== index),
    });
    setEditingRemovalIndex(null);
    setEditingRemovalText("");
  }

  function handleDismissRemoval(index: number) {
    if (!diffResult) return;
    setDiffResult({
      ...diffResult,
      removals: diffResult.removals.filter((_, i) => i !== index),
    });
    if (editingRemovalIndex === index) {
      setEditingRemovalIndex(null);
      setEditingRemovalText("");
    }
  }

  function handleStartEditRemoval(index: number, text: string) {
    setEditingRemovalIndex(index);
    setEditingRemovalText(text);
  }

  function handleCancelEditRemoval() {
    setEditingRemovalIndex(null);
    setEditingRemovalText("");
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
          <Link href="/patients" className="header-action" aria-label="患者一覧へ戻る" title="患者一覧へ戻る">
            <Home size={20} />
          </Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 relative z-[1] space-y-4">
        {error && (
          <div className="alert-error animate-fade-in">{error}</div>
        )}

        {!contents && !extractPreview && (
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

        {extractPreview && (
          <div className="card p-5 space-y-4 animate-fade-in-up">
            <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
              AIが抽出した看護内容（{extractPreview.length}件）
            </p>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              登録前に内容を編集したり、不要な項目を削除できます。確認できたら「この内容で登録する」を押してください。
            </p>
            {extractPreview.length > 0 ? (
              <ul className="space-y-2">
                {extractPreview.map((item, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-2 p-3 rounded-lg"
                    style={{ background: "var(--bg-tertiary)" }}
                  >
                    {editingPreviewIndex === i ? (
                      <>
                        <input
                          type="text"
                          className="input-field flex-1 text-sm"
                          value={editingPreviewText}
                          onChange={(e) => setEditingPreviewText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); handleSavePreviewEdit(i); }
                            if (e.key === "Escape") { e.preventDefault(); handleCancelPreviewEdit(); }
                          }}
                          autoFocus
                        />
                        <button onClick={() => handleSavePreviewEdit(i)} className="btn-outline" style={{ padding: "0.25rem 0.5rem" }} aria-label="保存">
                          <Save size={14} />
                        </button>
                        <button onClick={handleCancelPreviewEdit} className="btn-outline" style={{ padding: "0.25rem 0.5rem" }} aria-label="キャンセル">
                          <X size={14} />
                        </button>
                      </>
                    ) : (
                      <>
                        <Check size={16} style={{ color: "var(--accent-success)", flexShrink: 0 }} />
                        <button
                          onClick={() => handleStartEditPreview(i, item)}
                          className="flex-1 text-sm text-left"
                          style={{ color: "var(--text-primary)", background: "transparent", border: "none", padding: 0, cursor: "text" }}
                        >
                          {item}
                        </button>
                        <button onClick={() => handleStartEditPreview(i, item)} className="btn-outline" style={{ padding: "0.25rem 0.5rem" }} aria-label="編集" title="編集">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => handleDeletePreview(i)} className="btn-delete" aria-label="削除" title="削除">
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-center py-2" style={{ color: "var(--text-muted)" }}>
                すべて削除されました。「やめる」で戻れます。
              </p>
            )}
            <div className="flex gap-3">
              <button
                onClick={handleConfirmExtract}
                disabled={extractPreview.length === 0}
                className="btn-save flex-1"
                style={{ opacity: extractPreview.length === 0 ? 0.5 : 1 }}
              >
                この内容で登録する（{extractPreview.length}件）
              </button>
              <button
                onClick={() => { setExtractPreview(null); setEditingPreviewIndex(null); setEditingPreviewText(""); }}
                className="btn-outline"
              >
                やめる
              </button>
            </div>
          </div>
        )}

        {contents && !extractPreview && (
          <>
            {hasContents && (
            <div className="card overflow-hidden animate-fade-in-up">
              <div className="px-5 py-4" style={{ borderBottom: "1px solid rgba(0,0,0,0.04)" }}>
                <p className="font-semibold" style={{ color: "var(--text-primary)" }}>
                  登録済みケア項目（{contents.items.length}件）
                </p>
                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                  項目をクリックすると編集できます
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
                    {editingItemId === item.id ? (
                      <>
                        <input
                          type="text"
                          className="input-field flex-1 text-sm"
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); handleSaveEdit(); }
                            if (e.key === "Escape") { e.preventDefault(); handleCancelEdit(); }
                          }}
                          autoFocus
                        />
                        <button onClick={handleSaveEdit} className="btn-outline" style={{ padding: "0.25rem 0.5rem" }} aria-label="保存">
                          <Save size={14} />
                        </button>
                        <button onClick={handleCancelEdit} className="btn-outline" style={{ padding: "0.25rem 0.5rem" }} aria-label="キャンセル">
                          <X size={14} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => handleStartEdit(item)}
                          className="flex-1 text-sm text-left"
                          style={{ color: "var(--text-primary)", background: "transparent", border: "none", padding: 0, cursor: "text" }}
                        >
                          {item.text}
                        </button>
                        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                          {item.source === "ai" ? "AI" : "手動"}
                        </span>
                        <button onClick={() => handleStartEdit(item)} className="btn-outline" style={{ padding: "0.25rem 0.5rem" }} aria-label="編集" title="編集">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => handleDeleteItem(item.id)} className="btn-delete" aria-label="削除">
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            )}

            <div className="card p-5 animate-fade-in-up">
              <p className="input-label">ケア項目を追加（複数行・箇条書き対応）</p>
              <textarea
                rows={3}
                className="input-field text-sm"
                style={{ resize: "vertical", fontFamily: "inherit" }}
                placeholder="1行1項目。複数項目を一度にペースト可能。&#10;例：&#10;・バイタル測定&#10;・排便状態の確認&#10;・創部ガーゼ交換"
                value={newItemsText}
                onChange={(e) => setNewItemsText(e.target.value)}
              />
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {parseInputLines(newItemsText).length} 件追加されます
                </span>
                <button
                  onClick={handleAddItems}
                  disabled={parseInputLines(newItemsText).length === 0}
                  className="btn-outline"
                  style={{ borderRadius: "12px" }}
                >
                  <Plus size={16} />
                  追加
                </button>
              </div>
            </div>

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
                <p className="text-xs text-center" style={{ color: "var(--text-muted)" }}>
                  直近の記録から「追加した方が良い項目」「もう実施していない項目」をAIが提案します
                </p>
                {contents.lastAnalyzedAt && (
                  <p className="text-xs text-center" style={{ color: "var(--text-muted)" }}>
                    最終分析：{new Date(contents.lastAnalyzedAt).toLocaleDateString("ja-JP")}
                  </p>
                )}
              </div>
            )}

            {diffResult && (
              <div className="card p-5 space-y-4 animate-fade-in-up">
                <p className="font-semibold" style={{ color: "var(--text-primary)" }}>AI分析結果</p>
                {diffResult.reason && (
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>{diffResult.reason}</p>
                )}

                {diffResult.additions.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold" style={{ color: "var(--accent-success)" }}>
                      追加候補（{diffResult.additions.length}件）
                    </p>
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                      文言を編集してから採用できます。要らない候補は「却下」で消せます。
                    </p>
                    {diffResult.additions.map((text, i) => (
                      <div
                        key={i}
                        className="p-3 rounded-lg space-y-2"
                        style={{ background: "rgba(0, 200, 150, 0.05)", border: "1px solid rgba(0, 200, 150, 0.15)" }}
                      >
                        {editingAdditionIndex === i ? (
                          <>
                            <input
                              type="text"
                              className="input-field w-full text-sm"
                              value={editingAdditionText}
                              onChange={(e) => setEditingAdditionText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") { e.preventDefault(); handleAcceptAddition(i); }
                                if (e.key === "Escape") { e.preventDefault(); handleCancelEditAddition(); }
                              }}
                              autoFocus
                            />
                            <div className="flex gap-2 justify-end">
                              <button onClick={() => handleAcceptAddition(i)} className="btn-quick" style={{ color: "var(--accent-success)", borderColor: "var(--accent-success)" }}>
                                <Check size={14} /> この内容で採用
                              </button>
                              <button onClick={handleCancelEditAddition} className="btn-outline" style={{ padding: "0.25rem 0.5rem" }} aria-label="編集キャンセル">
                                <X size={14} />
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="flex-1 text-sm" style={{ color: "var(--text-primary)" }}>{text}</span>
                            <button onClick={() => handleStartEditAddition(i, text)} className="btn-outline" style={{ padding: "0.25rem 0.5rem" }} aria-label="編集" title="編集してから採用">
                              <Pencil size={14} />
                            </button>
                            <button onClick={() => handleAcceptAddition(i)} className="btn-quick" style={{ color: "var(--accent-success)", borderColor: "var(--accent-success)" }}>
                              <Check size={14} /> 採用
                            </button>
                            <button onClick={() => handleDismissAddition(i)} className="btn-outline" style={{ padding: "0.25rem 0.5rem", color: "var(--text-muted)" }} aria-label="却下" title="この候補を却下（リストには入れない）">
                              <X size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {diffResult.removals.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold" style={{ color: "var(--accent-error)" }}>
                      削除候補（{diffResult.removals.length}件）
                    </p>
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                      「削除」でリストから消えます。「却下」で今のリストに残します。編集すれば文言を修正して残せます。
                    </p>
                    {diffResult.removals.map((text, i) => (
                      <div
                        key={i}
                        className="p-3 rounded-lg space-y-2"
                        style={{ background: "rgba(255, 68, 68, 0.04)", border: "1px solid rgba(255, 68, 68, 0.15)" }}
                      >
                        {editingRemovalIndex === i ? (
                          <>
                            <input
                              type="text"
                              className="input-field w-full text-sm"
                              value={editingRemovalText}
                              onChange={(e) => setEditingRemovalText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") { e.preventDefault(); handleKeepWithEdit(i); }
                                if (e.key === "Escape") { e.preventDefault(); handleCancelEditRemoval(); }
                              }}
                              autoFocus
                            />
                            <div className="flex gap-2 justify-end">
                              <button onClick={() => handleKeepWithEdit(i)} className="btn-quick" style={{ color: "var(--accent-cyan)", borderColor: "var(--accent-cyan)" }}>
                                <Save size={14} /> この内容で残す
                              </button>
                              <button onClick={handleCancelEditRemoval} className="btn-outline" style={{ padding: "0.25rem 0.5rem" }} aria-label="編集キャンセル">
                                <X size={14} />
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="flex-1 text-sm" style={{ color: "var(--text-primary)" }}>{text}</span>
                            <button onClick={() => handleStartEditRemoval(i, text)} className="btn-outline" style={{ padding: "0.25rem 0.5rem" }} aria-label="編集して残す" title="編集して残す">
                              <Pencil size={14} />
                            </button>
                            <button onClick={() => handleAcceptRemoval(i)} className="btn-quick" style={{ color: "var(--accent-error)", borderColor: "var(--accent-error)" }}>
                              <Trash2 size={14} /> 削除
                            </button>
                            <button onClick={() => handleDismissRemoval(i)} className="btn-outline" style={{ padding: "0.25rem 0.5rem", color: "var(--text-muted)" }} aria-label="却下" title="削除しない（リストに残す）">
                              <X size={14} />
                            </button>
                          </div>
                        )}
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
      </main>
    </div>
  );
}
