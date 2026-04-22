"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  getPatients, getRecords, getNursingContents, saveNursingContents, generateId,
  type Patient, type SoapRecord, type NursingContents, type NursingContentItem,
} from "@/lib/storage";
import { ArrowLeft, Plus, Trash2, Sparkles, RefreshCw, Check, X, Home, Pencil, Save, Wand2, Undo2 } from "lucide-react";

export default function NursingContentsPage() {
  const { id } = useParams<{ id: string }>();
  const [patient, setPatient] = useState<Patient | null>(null);
  const [contents, setContents] = useState<NursingContents | null>(null);
  const [records, setRecords] = useState<SoapRecord[]>([]);
  const [newItemsText, setNewItemsText] = useState("");
  const [loading, setLoading] = useState(false);
  const [refining, setRefining] = useState(false);
  const [error, setError] = useState("");

  // インライン編集
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  // AI差分分析の結果
  const [diffResult, setDiffResult] = useState<{
    additions: string[];
    removals: string[];
    reason: string;
  } | null>(null);

  // AI初回抽出のプレビュー
  const [extractPreview, setExtractPreview] = useState<string[] | null>(null);

  // 「AIで整え直す」プレビュー
  const [refinePreview, setRefinePreview] = useState<{
    refined_items: { text: string; category: string; origin: string }[];
    duplicates_check: string[];
    reason: string;
  } | null>(null);

  // 「元に戻す」用バックアップ（直前の適用の取り消し用、1回のみ）
  const [lastItemsBackup, setLastItemsBackup] = useState<NursingContentItem[] | null>(null);

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

  // 複数テキストを行単位・箇条書き単位で分割
  function parseInputLines(raw: string): string[] {
    return raw
      .split("\n")
      .map((line) =>
        line
          .trim()
          // 行頭の箇条書き記号や番号を除去
          .replace(/^[・•\-＊\*\+]\s*/, "")
          .replace(/^\d+[\.\)]\s*/, "")
          .trim()
      )
      .filter((line) => line.length > 0);
  }

  // 手動追加（複数項目一括対応）
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

  // 項目削除
  async function handleDeleteItem(itemId: string) {
    if (!contents) return;
    const items = contents.items.filter((i) => i.id !== itemId);
    await updateContents(items);
  }

  // インライン編集
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

  // AIで整え直す
  async function handleRefine() {
    if (!contents || contents.items.length === 0) return;
    setRefining(true);
    setError("");
    try {
      const res = await fetch("/api/nursing-contents/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentItems: contents.items.map((i) => i.text),
          enableCategorization: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setRefinePreview({
        refined_items: data.refined_items ?? [],
        duplicates_check: data.duplicates_check ?? [],
        reason: data.reason ?? "",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI整理に失敗しました");
    } finally {
      setRefining(false);
    }
  }

  async function handleApplyRefine() {
    if (!refinePreview || !contents) return;
    // バックアップ取得（元に戻す用）
    setLastItemsBackup(contents.items);
    const now = new Date().toISOString();
    const newItems: NursingContentItem[] = refinePreview.refined_items.map((ri) => ({
      id: generateId(),
      text: ri.category?.trim()
        ? `[${ri.category}] ${ri.text}`
        : ri.text,
      isActive: true,
      source: "ai" as const,
      addedAt: now,
    }));
    await updateContents(newItems);
    setRefinePreview(null);
  }

  async function handleUndoRefine() {
    if (!lastItemsBackup) return;
    await updateContents(lastItemsBackup);
    setLastItemsBackup(null);
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
          <Link href="/patients" className="header-action" aria-label="患者一覧へ戻る" title="患者一覧へ戻る">
            <Home size={20} />
          </Link>
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

            {/* 手動追加フォーム（複数行対応） */}
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

            {/* AIで整え直す */}
            <div className="card p-5 space-y-3 animate-fade-in-up" style={{ borderLeft: "3px solid var(--accent-cyan)" }}>
              <div className="flex items-center gap-2">
                <Wand2 size={16} style={{ color: "var(--accent-cyan)" }} />
                <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  AIで整え直す
                </p>
              </div>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                重複統合・語尾統一・カテゴリ分類（任意）をAIが提案します。承認するまで現在のリストは変わりません。
              </p>
              <div className="flex gap-2 flex-wrap">
                <button onClick={handleRefine} disabled={refining} className="btn-outline">
                  <Wand2 size={14} className={refining ? "animate-spin" : ""} />
                  {refining ? "AI整理中..." : "整理案を生成"}
                </button>
                {lastItemsBackup && (
                  <button onClick={handleUndoRefine} className="btn-outline">
                    <Undo2 size={14} />
                    直前の適用を元に戻す
                  </button>
                )}
              </div>
            </div>

            {/* 整理案プレビュー */}
            {refinePreview && (
              <div className="card p-5 space-y-4 animate-fade-in-up" style={{ borderLeft: "3px solid var(--accent-cyan)" }}>
                <div>
                  <p className="text-sm font-semibold mb-1" style={{ color: "var(--text-primary)" }}>
                    AI整理案（{refinePreview.refined_items.length}件）
                  </p>
                  {refinePreview.reason && (
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>{refinePreview.reason}</p>
                  )}
                </div>
                {refinePreview.duplicates_check.length > 0 && (
                  <div className="p-3 rounded text-xs" style={{ background: "rgba(245, 158, 11, 0.05)", borderLeft: "2px solid rgb(245, 158, 11)" }}>
                    <p className="font-semibold mb-1" style={{ color: "#B45309" }}>統合された項目</p>
                    {refinePreview.duplicates_check.map((d, i) => (
                      <p key={i} style={{ color: "var(--text-muted)" }}>・{d}</p>
                    ))}
                  </div>
                )}
                <ul className="space-y-1">
                  {refinePreview.refined_items.map((ri, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm p-2 rounded" style={{ background: "var(--bg-tertiary)" }}>
                      {ri.category && (
                        <span className="text-xs px-2 py-0.5 rounded" style={{ background: "rgba(0,200,200,0.1)", color: "var(--accent-cyan)" }}>
                          {ri.category}
                        </span>
                      )}
                      <span className="flex-1" style={{ color: "var(--text-primary)" }}>{ri.text}</span>
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>{ri.origin}</span>
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <button onClick={handleApplyRefine} className="btn-save flex-1">
                    <Check size={14} />
                    この整理案を適用
                  </button>
                  <button onClick={() => setRefinePreview(null)} className="btn-outline">
                    <X size={14} />
                    キャンセル
                  </button>
                </div>
              </div>
            )}

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
            <p className="input-label">ケア項目を追加（複数行・箇条書き対応）</p>
            <textarea
              rows={4}
              className="input-field text-sm"
              style={{ resize: "vertical", fontFamily: "inherit" }}
              placeholder="1行1項目。複数項目を一度にペースト可能。&#10;例：&#10;・バイタル測定（血圧・脈拍・体温・SpO2）&#10;・排便状態の確認&#10;・ROM訓練"
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
